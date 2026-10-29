/**
 * A value applied after a pause in typing (012 FR-026a, PRD Q159, Q163; research §11): each offer restarts the
 * timer, a pending value is applied at once on flush (the fields closing) and by flushAll before quitting, so no
 * typed value is lost.
 */
import { registerFlusher } from "../../store/flush";

export interface Debounced<T> {
  /** A new value; the timer starts again. */
  offer(value: T): void;
  /** Applies the pending value now, if there is one. */
  flush(): void;
  /** Drops the pending value. */
  cancel(): void;
  pending(): boolean;
}

export function createDebounced<T>(delayMs: number, apply: (value: T) => void): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let value: { v: T } | null = null;
  let unregister: (() => void) | null = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    value = null;
    unregister?.();
    unregister = null;
  };

  const flush = () => {
    if (value === null) return;
    const { v } = value;
    clear();
    apply(v);
  };

  return {
    offer(v) {
      if (timer !== null) clearTimeout(timer);
      value = { v };
      timer = setTimeout(flush, delayMs);
      unregister ??= registerFlusher(() => {
        flush();
        return Promise.resolve();
      });
    },
    flush,
    cancel: clear,
    pending: () => value !== null,
  };
}
