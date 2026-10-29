/** Source of the current time, in UTC epoch milliseconds. Injected everywhere (constitution IV). */
export interface Clock {
  now(): number;
}

export function fixedClock(t: number): Clock {
  return { now: () => t };
}

export interface FakeClock extends Clock {
  advance(ms: number): void;
  set(t: number): void;
}

export function fakeClock(start: number): FakeClock {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
    set(next) {
      t = next;
    },
  };
}
