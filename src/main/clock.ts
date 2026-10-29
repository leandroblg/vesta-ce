import type { Clock } from "../domain/clock";

/** The only reader of the system clock in the main process (constitution IV). */
export const systemClock: Clock = { now: () => Date.now() };

/** Test-only control of the app clock, registered in unpackaged builds (003 research §8). */
export interface ClockHook {
  advance(ms: number): void;
  set(ms: number): void;
}

interface AppClockOptions {
  isPackaged: boolean;
  env: Readonly<Record<string, string | undefined>>;
  register: (hook: ClockHook) => void;
}

/**
 * The clock every main-process consumer uses. Packaged builds get the system clock. Unpackaged builds add
 * VESTA_CLOCK_OFFSET_MIN minutes and register a hook that moves the clock while the app runs.
 */
export function createAppClock({ isPackaged, env, register }: AppClockOptions): { clock: Clock; issues: string[] } {
  if (isPackaged) return { clock: systemClock, issues: [] };
  const issues: string[] = [];
  const raw = env["VESTA_CLOCK_OFFSET_MIN"];
  let offset = 0;
  if (raw !== undefined && raw !== "") {
    if (/^\d+$/.test(raw)) offset = Number(raw) * 60_000;
    else issues.push(`VESTA_CLOCK_OFFSET_MIN=${raw} ignored`);
  }
  const clock: Clock = { now: () => Date.now() + offset };
  register({
    advance(ms) {
      offset += ms;
    },
    set(ms) {
      offset = ms - Date.now();
    },
  });
  return { clock, issues };
}
