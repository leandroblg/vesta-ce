/** A reminder: the `reminders` table in camelCase (data-model.md). */
import type { Placeable } from "./list-placement";

export interface Reminder extends Placeable {
  id: string;
  textMd: string;
  position: number;
  createdAt: number;
  updatedAt: number;
  doneAt: number | null;
  deletedAt: number | null;
  /** 018 (PRD Q272, Q281): in the Trash, the completion date of a done reminder deleted from the Archive; else null. */
  keptDoneAt: number | null;
  prevSiblingId: string | null;
  nextSiblingId: string | null;
}

/** FR-007a (PRD A2, Q92): the empty card adds nothing while this many reminders are active. */
export const MAX_ACTIVE_REMINDERS = 200;

export function isActiveReminder(r: Reminder): boolean {
  return r.doneAt === null && r.deletedAt === null;
}

/**
 * What one reminder action writes. `sectionCollapsed` is the Reminders section's new collapsed state,
 * or null when it does not change; it is saved with the rows in the same transaction (FR-018).
 */
export interface ReminderChangeSet {
  upserts: Reminder[];
  removals: string[];
  sectionCollapsed: boolean | null;
}

export const emptyReminderChangeSet = (): ReminderChangeSet => ({ upserts: [], removals: [], sectionCollapsed: null });
