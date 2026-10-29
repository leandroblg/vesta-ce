/**
 * 018 FR-020a, FR-037 (PRD Q282, Q287, Q288, Q289; research §8, §16): when a cleanup's years, days and hours are sent.
 * Only main knows how many items a time would remove, so every valid total goes after the group's 2 s wait without a
 * commit; main saves it when no dialog is needed and otherwise answers `pending`. A pending total is sent again as a
 * commit when the focus leaves the group or Enter is pressed, which asks; it is dropped when the fields close. A total
 * still in its wait is sent when the fields close or Vesta quits, so a change that needs no dialog is never lost.
 */
import { createTimeGroupSaver, type SaveHow } from "./useTimeGroupSave";

export type CleanupSend = (hours: number, commit: boolean) => Promise<{ saved: boolean; pending: boolean } | null>;

export interface CleanupFieldsLogic {
  /** The fields' total after an edit: hours, or `"min"` for a refused zero total. */
  typed(total: number | "min"): void;
  moved(): void;
  left(): void;
  enter(): void;
  close(): void;
  /** The fields became disabled or show the saved value again: nothing is pending any more. */
  cancel(): void;
}

export function createCleanupFieldsLogic(send: CleanupSend, reset: () => void): CleanupFieldsLogic {
  let held: number | null = null;
  const go = (hours: number, commit: boolean) => {
    void send(hours, commit).then((r) => {
      if (r === null) {
        if (commit) reset();
        return;
      }
      if (!commit && r.pending) held = hours;
      else if (commit && !r.saved) reset();
    });
  };
  const saver = createTimeGroupSaver<number>((hours, how: SaveHow) => {
    go(hours, how === "leave" || how === "enter");
  });
  const commitHeld = () => {
    if (held === null) return;
    const hours = held;
    held = null;
    go(hours, true);
  };
  return {
    typed(total) {
      held = null;
      if (total === "min") saver.cancel();
      else saver.offer(total);
    },
    moved: () => {
      saver.moved();
    },
    left() {
      if (saver.pending()) saver.left();
      else commitHeld();
    },
    enter() {
      if (saver.pending()) saver.enter();
      else commitHeld();
    },
    close() {
      held = null;
      saver.close();
    },
    cancel() {
      held = null;
      saver.cancel();
    },
  };
}
