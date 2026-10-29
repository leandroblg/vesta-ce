/**
 * 018 FR-037 (PRD Q288, Q289; research §16; constitution VI's exception, v1.3.0): a group of time fields saves its typed
 * time when the focus leaves the group or Enter is pressed, or 2 s after the last keystroke or move between its fields,
 * whichever comes first. A move between the group's fields restarts the wait and never saves by itself; closing the
 * fields or quitting saves a pending time at once.
 */
import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";
import { registerFlusher } from "../../store/flush";

export const TIME_GROUP_DEBOUNCE_MS = 2000;

/** Why a time was saved: after the wait, on leaving the group, on Enter, or as the fields close or Vesta quits. */
export type SaveHow = "idle" | "leave" | "enter" | "close";

export interface TimeGroupSaver<T> {
  /** A valid typed value: the wait starts again. */
  offer(value: T): void;
  /** The focus moved to another field of the group: the wait starts again; nothing is saved. */
  moved(): void;
  left(): void;
  enter(): void;
  /** The fields close: a pending value is saved at once. */
  close(): void;
  /** An invalid value, or the fields disabled: the pending value is dropped. */
  cancel(): void;
  pending(): boolean;
}

export function createTimeGroupSaver<T>(apply: (value: T, how: SaveHow) => void): TimeGroupSaver<T> {
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
  const save = (how: SaveHow) => {
    if (value === null) return;
    const { v } = value;
    clear();
    apply(v, how);
  };
  const restart = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      save("idle");
    }, TIME_GROUP_DEBOUNCE_MS);
  };

  return {
    offer(v) {
      value = { v };
      restart();
      unregister ??= registerFlusher(() => {
        save("close");
        return Promise.resolve();
      });
    },
    moved() {
      if (value !== null) restart();
    },
    left() {
      save("leave");
    },
    enter() {
      save("enter");
    },
    close() {
      save("close");
    },
    cancel: clear,
    pending: () => value !== null,
  };
}

/**
 * The React side: the saver lives as long as the fields, and the fieldset's focus and key events drive it. `apply` may
 * change between renders; the latest one is used.
 */
export function useTimeGroupSave<T>(apply: (value: T, how: SaveHow) => void): {
  saver: TimeGroupSaver<T>;
  groupProps: {
    onFocus: (e: FocusEvent<HTMLElement>) => void;
    onBlur: (e: FocusEvent<HTMLElement>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  };
} {
  const latest = useRef(apply);
  useEffect(() => {
    latest.current = apply;
  });
  const saverRef = useRef<TimeGroupSaver<T> | null>(null);
  saverRef.current ??= createTimeGroupSaver<T>((v, how) => {
    latest.current(v, how);
  });
  const saver = saverRef.current;
  useEffect(
    () => () => {
      saver.close();
    },
    [saver],
  );
  return {
    saver,
    groupProps: {
      onFocus: (e) => {
        // A move inside the group (from one of its fields to another).
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) saver.moved();
      },
      onBlur: (e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) saver.left();
      },
      onKeyDown: (e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) saver.enter();
      },
    },
  };
}
