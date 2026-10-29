/**
 * 009 handlers for the log viewer and the level (contracts/ipc.md): `logs:read` pages through the files,
 * `logs:watch` tails new entries while the viewer is open, `settings:set-log-level` stores the level and moves
 * the recording floor at once (FR-010, FR-017, FR-018, FR-019).
 */
import type Database from "better-sqlite3";
import type { Clock } from "../../domain/clock";
import { recordFloor, type LogLevel, type RecordFloor } from "../../domain/logs/levels";
import type { EventChannel, EventMap, LogLine } from "../../shared/ipc-contract";
import { saveLogLevel } from "../db/settings-repo";
import type { Logger, WrittenEntry } from "../log";
import { logsDir } from "../logs/files";
import { readLogPage, type ReadOptions } from "../logs/reader";
import type { AsyncHandlers, Handlers } from "./handlers";

export interface LogHandlerDeps {
  db: () => Database.Database;
  clock: Clock;
  dataDir: string;
  log: Logger;
  watch: (level: LogLevel, listener: (e: WrittenEntry) => void) => () => void;
  setFloor: (floor: RecordFloor) => void;
  send: <E extends EventChannel>(event: E, payload: EventMap[E]) => void;
  timer?: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (h: unknown) => void };
  readOptions?: ReadOptions;
}

export const TAIL_BATCH_MS = 250;

export const toLine = (e: WrittenEntry): LogLine => ({ time: e.time, level: e.level, event: e.event, fields: e.fields, raw: null, cut: false });

export function buildLogHandlers(deps: LogHandlerDeps): { handlers: Handlers; asyncHandlers: AsyncHandlers; stop: () => void } {
  const timer = deps.timer ?? {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (h: unknown) => {
      clearTimeout(h as NodeJS.Timeout);
    },
  };
  let unwatch: (() => void) | null = null;
  let pending: LogLine[] = [];
  let flushTimer: unknown = null;
  let readFailureLogged = false;

  const flush = () => {
    flushTimer = null;
    if (pending.length === 0) return;
    // Newest first, like the pages (PRD Q127).
    const lines = pending.reverse();
    pending = [];
    deps.send("logs:appended", { lines });
  };

  const stop = () => {
    unwatch?.();
    unwatch = null;
    if (flushTimer !== null) timer.clearTimeout(flushTimer);
    flushTimer = null;
    pending = [];
  };

  return {
    handlers: {
      "logs:watch": ({ on, level }) => {
        stop();
        if (!on) return null;
        readFailureLogged = false;
        unwatch = deps.watch(level, (e) => {
          pending.push(toLine(e));
          flushTimer ??= timer.setTimeout(flush, TAIL_BATCH_MS);
        });
        return null;
      },
      "settings:set-log-level": ({ level }) => {
        saveLogLevel(deps.db(), level, deps.clock.now());
        deps.setFloor(recordFloor(level));
        return null;
      },
    },
    asyncHandlers: {
      "logs:read": async ({ cursor, level }) => {
        const page = await readLogPage(logsDir(deps.dataDir), cursor, level, deps.readOptions);
        // Story 2 scenario 9: a read failure is logged once per viewer opening (analysis M4).
        if (page.unreadable && !readFailureLogged) {
          readFailureLogged = true;
          deps.log.error("logs.read-failed", { message: "the logs folder could not be read" });
        }
        return page;
      },
    },
    stop,
  };
}
