/**
 * The Vesta logger (009 research §1–§5). `electron-log/node` provides levels and dispatch; it is used without
 * Electron IPC (electron-log/main registers listeners outside the contract) and with every built-in transport
 * off. One Vesta transport formats the JSON line, writes the home folder as `~`, and writes through the pure
 * rotation plan: `vesta-NNN.log` files of at most 1 MiB, 50 MiB in all. Fatal, Error, Warn and Info are always
 * recorded; Debug and Trace only while the floor allows them. A failed write goes to stderr.
 */
import { homedir } from "node:os";
import electronLog from "electron-log/node";
import type { Clock } from "../domain/clock";
import { formatEntry } from "../domain/logs/entry";
import { records, shows, type LogLevel, type RecordFloor } from "../domain/logs/levels";
import { redact } from "../domain/logs/redact";
import { planWrite, type LogFileInfo } from "../domain/logs/rotation";
import { systemClock } from "./clock";
import { appendLine, listLogFiles, logsDir, removeLogFile } from "./logs/files";

type Fields = Record<string, unknown>;

/** What the viewer's live tail receives for each written entry (FR-018). */
export interface WrittenEntry {
  time: number;
  level: LogLevel;
  event: string;
  fields: Fields;
}

interface LogOptions {
  clock?: Clock;
  /** The user's home folder, written as `~` (FR-003). */
  home?: string;
}

let dir: string | null = null;
let files: LogFileInfo[] | null = null;
let floor: RecordFloor = "info";
let clock: Clock = systemClock;
let home = homedir();
const watchers = new Set<{ level: LogLevel; listener: (e: WrittenEntry) => void }>();

const core = electronLog.create({ logId: "vesta" });
core.addLevel("fatal", 0);
core.addLevel("trace");
// The node build has no ipc transport (undefined); every other built-in one is switched off.
for (const transport of Object.values<(typeof core.transports)[string] | undefined>(core.transports)) {
  if (typeof transport === "function") transport.level = false;
}

function writeLine(entry: WrittenEntry): void {
  const line = formatEntry(entry);
  if (dir !== null) {
    try {
      files ??= listLogFiles(dir);
      const bytes = Buffer.byteLength(line);
      const plan = planWrite(files, bytes);
      for (const name of plan.delete) removeLogFile(dir, name);
      appendLine(dir, plan.file, line);
      const kept = files.filter((f) => !plan.delete.includes(f.name));
      const target = kept.find((f) => f.name === plan.file);
      if (target === undefined) {
        const number = Number(/\d{3}/.exec(plan.file)?.[0]);
        kept.push({ name: plan.file, number, size: bytes });
      } else {
        target.size += bytes;
      }
      files = kept;
      return;
    } catch {
      files = null; // list the folder again next time (FR-008)
    }
  }
  process.stderr.write(line);
}

const vestaTransport = Object.assign(
  (message: { data: unknown[]; level: string }) => {
    const [event, fields] = message.data as [string, Fields | undefined];
    const entry: WrittenEntry = { time: clock.now(), level: message.level as LogLevel, event, fields: redact(fields ?? {}, home) };
    writeLine(entry);
    for (const w of watchers) if (shows(entry.level, w.level)) w.listener(entry);
  },
  { level: "trace", transforms: [] },
);
core.transports["vesta"] = vestaTransport as unknown as (typeof core.transports)[string];

export function initLog(dataDir: string, options: LogOptions = {}): void {
  dir = logsDir(dataDir);
  files = null;
  clock = options.clock ?? systemClock;
  home = options.home ?? homedir();
}

/** The recording floor: `info` until settings are read, then from the stored level (FR-010). */
export function setFloor(next: RecordFloor): void {
  floor = next;
}

/** Entries written at or above `level` go to `listener` until the returned function is called (FR-018). */
export function watch(level: LogLevel, listener: (e: WrittenEntry) => void): () => void {
  const w = { level, listener };
  watchers.add(w);
  return () => {
    watchers.delete(w);
  };
}

function write(level: LogLevel, event: string, fields: Fields): void {
  if (!records(level, floor)) return;
  core.processMessage({ data: [event, fields], level: level as never, date: new Date(clock.now()) });
}

export const log = {
  fatal: (event: string, fields: Fields = {}) => {
    write("fatal", event, fields);
  },
  error: (event: string, fields: Fields = {}) => {
    write("error", event, fields);
  },
  warn: (event: string, fields: Fields = {}) => {
    write("warn", event, fields);
  },
  info: (event: string, fields: Fields = {}) => {
    write("info", event, fields);
  },
  debug: (event: string, fields: Fields = {}) => {
    write("debug", event, fields);
  },
  trace: (event: string, fields: Fields = {}) => {
    write("trace", event, fields);
  },
};

export type Logger = typeof log;

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
