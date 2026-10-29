import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Reminder } from "../../../src/domain/reminder";
import type { Task } from "../../../src/domain/task";

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "vesta-test-"));
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let n = 0;
const CREATED = 1000;
export function makeTask(overrides: Partial<Task> = {}): Task {
  n += 1;
  const hex = n.toString(16).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${hex}`,
    parentId: null,
    titleMd: `Task ${String(n)}`,
    position: n,
    createdAt: CREATED,
    updatedAt: 1000,
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

let r = 0;
export function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  r += 1;
  const hex = (0x100000 + r).toString(16).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${hex}`,
    textMd: `Reminder ${String(r)}`,
    position: r,
    createdAt: 1000,
    updatedAt: 1000,
    doneAt: null,
    deletedAt: null,
    keptDoneAt: null,
    prevSiblingId: null,
    nextSiblingId: null,
    ...overrides,
  };
}
