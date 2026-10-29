/** The purge, with 018's two automatic cleanups, at launch and every hour while open (FR-035; 018 FR-017). */
import type { Clock } from "../domain/clock";
import type { Logger } from "./log";
import { errorMessage } from "./log";

export const PURGE_INTERVAL_MS = 60 * 60 * 1000;

interface Timer {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

interface Options {
  clock: Clock;
  timer: Timer;
  /**
   * Removes expired rows in one transaction and returns their ids, with the count by cleanup (018); it reads the
   * cleanup settings itself, so a change is used at the next run. Throws on failure.
   */
  purge: (now: number) => string[] | PurgeOutcome;
  onPurged: (ids: string[]) => void;
  log: Logger;
  /** 008 FR-050, FR-037c: no purge during an export, an import or an Undo import offer; a due run waits for idle. */
  gate?: MaintenanceGate;
  /** 018 T066 (constitution VI): the start run waits for this signal, the window shown, so a large purge never delays it. */
  afterShown?: (fn: () => void) => void;
}

export interface PurgeOutcome {
  ids: string[];
  archive: number;
  trash: number;
}

/** Stops the timer; `runNow` (018 test hook) runs once through the gate and resolves when that run has happened. */
export interface PurgeScheduler {
  (): void;
  runNow(): Promise<void>;
}

export interface MaintenanceGate {
  maintenanceAllowed(): boolean;
  whenIdle(fn: () => void): void;
}

export function startPurgeScheduler({ clock, timer, purge, onPurged, log, gate, afterShown }: Options): PurgeScheduler {
  const purgeNow = () => {
    try {
      const t0 = performance.now();
      const out = purge(clock.now());
      const ids = Array.isArray(out) ? out : out.ids;
      log.debug("purge.run", { ms: Math.round(performance.now() - t0), count: ids.length });
      if (ids.length > 0) {
        if (Array.isArray(out)) log.info("purge.removed", { count: ids.length });
        else log.info("purge.removed", { count: ids.length, archive: out.archive, trash: out.trash });
        onPurged(ids);
      }
    } catch (err) {
      log.error("purge.failed", { message: errorMessage(err) }); // retried at the next run
    }
  };
  const run = () => {
    if (gate === undefined || gate.maintenanceAllowed()) purgeNow();
    else gate.whenIdle(purgeNow);
  };
  if (afterShown === undefined) run();
  else afterShown(run);
  const handle = timer.setInterval(run, PURGE_INTERVAL_MS);
  const stop = () => {
    timer.clearInterval(handle);
  };
  const runNow = () =>
    new Promise<void>((resolve) => {
      if (gate === undefined || gate.maintenanceAllowed()) {
        purgeNow();
        resolve();
      } else
        gate.whenIdle(() => {
          purgeNow();
          resolve();
        });
    });
  return Object.assign(stop, { runNow });
}
