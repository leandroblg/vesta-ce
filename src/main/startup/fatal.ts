/**
 * What happens after an uncaught exception in the main process (010 FR-026, audit L16, research §8): log it,
 * leave a time-only marker for the next start, stop the schedulers, flush the page's pending edits (2 s), close
 * the database and exit. Nothing here depends on the database: it may be the thing that failed.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MARKER_FILE = "abnormal-exit.json";
/** The hard deadline: the flush has its own 2 s limit; this covers everything else hanging. */
export const FATAL_EXIT_MS = 3_000;

export interface FatalDeps {
  log: { fatal: (event: string, fields: Record<string, unknown>) => void; error: (event: string, fields: Record<string, unknown>) => void };
  now: () => number;
  dataDir: string;
  /** False in read-only mode: no marker can be written there (FR-038a). */
  writable: boolean;
  stopSchedulers: () => void;
  flush: () => Promise<void>;
  closeDb: () => void;
  exit: (code: number) => void;
  setTimer?: (fn: () => void, ms: number) => void;
}

export function markerPath(dataDir: string): string {
  return join(dataDir, MARKER_FILE);
}

/** `{"at": <ms>}` and nothing else, owner-only (L9); any failure is the caller's to log. */
export function writeMarker(dataDir: string, at: number): void {
  writeFileSync(markerPath(dataDir), JSON.stringify({ at }), { mode: 0o600 });
}

/** The time of the previous abnormal exit, removing the marker; null when absent or unreadable. */
export function readMarker(dataDir: string): number | null {
  const path = markerPath(dataDir);
  if (!existsSync(path)) return null;
  let at: number | null = null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { at?: unknown }).at === "number") {
      at = (parsed as { at: number }).at;
    }
  } catch {
    at = null;
  }
  try {
    unlinkSync(path);
  } catch {
    // leaving an unreadable marker behind is harmless: it is replaced at the next abnormal exit
  }
  return at;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The handler for `process.on("uncaughtException")`. A second exception while handling exits at once. */
export function createFatalHandler(deps: FatalDeps): (err: unknown) => Promise<void> {
  let handling = false;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  return async (err: unknown) => {
    if (handling) {
      deps.exit(1);
      return;
    }
    handling = true;
    deps.log.fatal("main.uncaught-exception", { message: errorMessage(err), stack: err instanceof Error ? (err.stack ?? null) : null });
    if (deps.writable) {
      try {
        writeMarker(deps.dataDir, deps.now());
      } catch (markerErr) {
        deps.log.error("fatal.marker-failed", { message: errorMessage(markerErr) });
      }
    }
    try {
      deps.stopSchedulers();
    } catch (stopErr) {
      deps.log.error("fatal.stop-failed", { message: errorMessage(stopErr) });
    }
    setTimer(() => {
      deps.exit(1);
    }, FATAL_EXIT_MS);
    try {
      await deps.flush();
    } catch (flushErr) {
      deps.log.error("fatal.flush-failed", { message: errorMessage(flushErr) });
    }
    try {
      deps.closeDb();
    } catch (closeErr) {
      deps.log.error("fatal.close-failed", { message: errorMessage(closeErr) });
    }
    deps.exit(1);
  };
}
