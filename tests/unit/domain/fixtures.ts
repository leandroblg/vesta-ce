import type { Reminder } from "../../../src/domain/reminder";
import type { Task } from "../../../src/domain/task";

let n = 0;
const CREATED = 100;

/** Deterministic ids: 00000000-0000-4000-8000-<12 hex>. */
export function id(k: number): string {
  return `00000000-0000-4000-8000-${k.toString(16).padStart(12, "0")}`;
}

export function mk(overrides: Partial<Task> = {}): Task {
  n += 1;
  return {
    id: id(1000 + n),
    parentId: null,
    titleMd: `T${String(n)}`,
    position: n,
    createdAt: CREATED,
    updatedAt: 100,
    doneAt: null,
    deletedAt: null,
    collapsed: false,
    prevSiblingId: null,
    nextSiblingId: null,
    leftWithId: null,
    keptDoneAt: null,
    alertOverrideMin: null,
    staleBaseAt: overrides.createdAt ?? CREATED,
    staleSince: null,
    wasStale: false,
    lastBlinkAt: null,
    firstBlinkCount: null,
    manuallyPositioned: false,
    lastSignalAt: null,
    detailsMd: "",
    rescheduleForMin: null,
    ...overrides,
  };
}

/** A newId() that returns id(1), id(2), … */
export function idGen(start = 1): () => string {
  let k = start;
  return () => id(k++);
}

let r = 0;
export function mkReminder(overrides: Partial<Reminder> = {}): Reminder {
  r += 1;
  return {
    id: id(5000 + r),
    textMd: `R${String(r)}`,
    position: r,
    createdAt: 100,
    updatedAt: 100,
    doneAt: null,
    deletedAt: null,
    keptDoneAt: null,
    prevSiblingId: null,
    nextSiblingId: null,
    ...overrides,
  };
}
