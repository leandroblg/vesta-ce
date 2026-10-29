/**
 * Reads reminders and the Reminders section's collapsed state, and applies a ReminderChangeSet with
 * the setting in one transaction (FR-003, FR-018, FR-021, FR-022).
 */
import type Database from "better-sqlite3";
import type { Reminder, ReminderChangeSet } from "../../domain/reminder";
import { faultActive } from "../faults";
import { SaveFailedError } from "./tasks-repo";

const COLLAPSED_KEY = "remindersCollapsed";

interface Row {
  id: string;
  text_md: string;
  position: number;
  created_at: number;
  updated_at: number;
  done_at: number | null;
  deleted_at: number | null;
  kept_done_at: number | null;
  prev_sibling_id: string | null;
  next_sibling_id: string | null;
}

const toReminder = (r: Row): Reminder => ({
  id: r.id,
  textMd: r.text_md,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  doneAt: r.done_at,
  deletedAt: r.deleted_at,
  keptDoneAt: r.kept_done_at,
  prevSiblingId: r.prev_sibling_id,
  nextSiblingId: r.next_sibling_id,
});

const toParams = (r: Reminder) => ({
  id: r.id,
  text_md: r.textMd,
  position: r.position,
  created_at: r.createdAt,
  updated_at: r.updatedAt,
  done_at: r.doneAt,
  deleted_at: r.deletedAt,
  kept_done_at: r.keptDoneAt,
  prev_sibling_id: r.prevSiblingId,
  next_sibling_id: r.nextSiblingId,
});

const UPSERT = `
insert into reminders (id, text_md, position, created_at, updated_at, done_at, deleted_at, prev_sibling_id, next_sibling_id, kept_done_at)
values (@id, @text_md, @position, @created_at, @updated_at, @done_at, @deleted_at, @prev_sibling_id, @next_sibling_id, @kept_done_at)
on conflict(id) do update set
  text_md = excluded.text_md, position = excluded.position, created_at = excluded.created_at,
  updated_at = excluded.updated_at, done_at = excluded.done_at, deleted_at = excluded.deleted_at,
  prev_sibling_id = excluded.prev_sibling_id, next_sibling_id = excluded.next_sibling_id, kept_done_at = excluded.kept_done_at`;

const SET_SETTING = `
insert into settings (key, value, updated_at) values (@key, @value, @updated_at)
on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`;

export function loadReminders(db: Database.Database): Reminder[] {
  return (db.prepare("select * from reminders order by position").all() as Row[]).map(toReminder);
}

/** A missing row means expanded (FR-003 default). */
export function loadRemindersCollapsed(db: Database.Database): boolean {
  const row = db.prepare("select value from settings where key = ?").get(COLLAPSED_KEY) as { value: string } | undefined;
  return row === undefined ? false : JSON.parse(row.value) === true;
}

/** One transaction: rows and the collapsed setting are all saved, or none is. Throws SaveFailedError. */
export function applyReminderChangeSet(db: Database.Database, changes: ReminderChangeSet, now: number): void {
  if (changes.upserts.length === 0 && changes.removals.length === 0 && changes.sectionCollapsed === null) return;
  try {
    const upsert = db.prepare(UPSERT);
    const remove = db.prepare("delete from reminders where id = ?");
    db.transaction(() => {
      for (const r of changes.upserts) upsert.run(toParams(r));
      if (changes.sectionCollapsed !== null) {
        db.prepare(SET_SETTING).run({ key: COLLAPSED_KEY, value: JSON.stringify(changes.sectionCollapsed), updated_at: now });
      }
      if (faultActive("save")) throw new Error("VESTA_FAULT=save");
      for (const id of changes.removals) remove.run(id);
    })();
  } catch (err) {
    throw new SaveFailedError(err);
  }
}
