/** 009 helpers: seeding and reading log files (contracts/log-format.md). */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { orderFiles } from "../../../src/domain/logs/rotation";

export const logDir = (dataDir: string) => join(dataDir, "logs");
const LOG_NAME = /^vesta-(\d{3})\.log$/;

export interface Entry {
  time: string;
  level: string;
  event: string;
  [field: string]: unknown;
}

export interface SeedSpec {
  /** File numbers in write order, oldest first (999 → 001 wraps allowed). */
  numbers: number[];
  /** Entries per file. */
  perFile: number;
  /** Levels used in turn. */
  levels?: string[];
  /** Pad each entry's message to about this many bytes. */
  entryBytes?: number;
  /** Time of the first entry; each next one is 1 s later. */
  startMs?: number;
}

/** Writes log files directly, before a launch; returns every entry in write order. */
export function seedLogs(dataDir: string, spec: SeedSpec): Entry[] {
  const dir = logDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const levels = spec.levels ?? ["info", "warn", "error", "debug", "info", "fatal", "trace"];
  const pad = spec.entryBytes === undefined ? "" : "x".repeat(Math.max(0, spec.entryBytes - 120));
  let t = spec.startMs ?? Date.UTC(2026, 9, 19, 12, 0, 0);
  let n = 0;
  const all: Entry[] = [];
  for (const num of spec.numbers) {
    const lines: string[] = [];
    for (let i = 0; i < spec.perFile; i++) {
      const entry: Entry = { time: new Date(t).toISOString(), level: levels[n % levels.length] ?? "info", event: "seed.entry", seq: n, message: `entry ${String(n)}${pad}` };
      lines.push(JSON.stringify(entry));
      all.push(entry);
      t += 1000;
      n += 1;
    }
    writeFileSync(join(dir, `vesta-${String(num).padStart(3, "0")}.log`), lines.map((l) => `${l}\n`).join(""));
  }
  return all;
}

/** Every readable entry, files oldest to newest (unreadable lines skipped). */
export function readLogEntries(dataDir: string): Entry[] {
  const dir = logDir(dataDir);
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => LOG_NAME.test(f));
  } catch {
    return [];
  }
  const ordered = orderFiles(names.map((f) => Number(LOG_NAME.exec(f)?.[1])));
  const out: Entry[] = [];
  for (const num of ordered) {
    const text = readFileSync(join(dir, `vesta-${String(num).padStart(3, "0")}.log`), "utf8");
    for (const line of text.split("\n")) {
      if (line === "") continue;
      try {
        out.push(JSON.parse(line) as Entry);
      } catch {
        // an unreadable line
      }
    }
  }
  return out;
}

export const entriesFor = (dataDir: string, event: string): Entry[] => readLogEntries(dataDir).filter((e) => e.event === event);

/** The whole text of every log file, for "this text never appears" checks. */
export function allLogText(dataDir: string): string {
  const dir = logDir(dataDir);
  try {
    return readdirSync(dir)
      .filter((f) => LOG_NAME.test(f))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("");
  } catch {
    return "";
  }
}
