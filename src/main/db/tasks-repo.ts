/** Reads tasks and applies a ChangeSet atomically (FR-039, FR-040, FR-040a). */
import type Database from "better-sqlite3";
import { writeEvents } from "./events-repo";
import type { ChangeSet, Task } from "../../domain/task";
import { faultActive } from "../faults";

export class SaveFailedError extends Error {
  constructor(override readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "SaveFailedError";
  }
}

interface Row {
  id: string;
  parent_id: string | null;
  title_md: string;
  position: number;
  created_at: number;
  updated_at: number;
  done_at: number | null;
  deleted_at: number | null;
  collapsed: number;
  prev_sibling_id: string | null;
  next_sibling_id: string | null;
  left_with_id: string | null;
  alert_period_override_min: number | null;
  stale_base_at: number;
  stale_since: number | null;
  was_stale: number;
  last_blink_at: number | null;
  first_blink_count: number | null;
  manually_positioned: number;
  last_signal_at: number | null;
  details_md: string;
  reschedule_for_min: number | null;
  kept_done_at: number | null;
}

const toTask = (r: Row): Task => ({
  id: r.id,
  parentId: r.parent_id,
  titleMd: r.title_md,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  doneAt: r.done_at,
  deletedAt: r.deleted_at,
  collapsed: r.collapsed === 1,
  prevSiblingId: r.prev_sibling_id,
  nextSiblingId: r.next_sibling_id,
  leftWithId: r.left_with_id,
  alertOverrideMin: r.alert_period_override_min,
  staleBaseAt: r.stale_base_at,
  staleSince: r.stale_since,
  wasStale: r.was_stale === 1,
  lastBlinkAt: r.last_blink_at,
  firstBlinkCount: r.first_blink_count === 1 || r.first_blink_count === 3 ? r.first_blink_count : null,
  manuallyPositioned: r.manually_positioned === 1,
  lastSignalAt: r.last_signal_at,
  detailsMd: r.details_md,
  rescheduleForMin: r.reschedule_for_min,
  keptDoneAt: r.kept_done_at,
});

const toParams = (t: Task) => ({
  id: t.id,
  parent_id: t.parentId,
  title_md: t.titleMd,
  position: t.position,
  created_at: t.createdAt,
  updated_at: t.updatedAt,
  done_at: t.doneAt,
  deleted_at: t.deletedAt,
  collapsed: t.collapsed ? 1 : 0,
  prev_sibling_id: t.prevSiblingId,
  next_sibling_id: t.nextSiblingId,
  left_with_id: t.leftWithId,
  alert_period_override_min: t.alertOverrideMin,
  stale_base_at: t.staleBaseAt,
  stale_since: t.staleSince,
  was_stale: t.wasStale ? 1 : 0,
  last_blink_at: t.lastBlinkAt,
  first_blink_count: t.firstBlinkCount,
  manually_positioned: t.manuallyPositioned ? 1 : 0,
  last_signal_at: t.lastSignalAt,
  details_md: t.detailsMd,
  reschedule_for_min: t.rescheduleForMin,
  kept_done_at: t.keptDoneAt,
});

const UPSERT = `
insert into tasks (id, parent_id, title_md, position, created_at, updated_at, done_at, deleted_at, collapsed,
                   prev_sibling_id, next_sibling_id, left_with_id, alert_period_override_min, stale_base_at,
                   stale_since, was_stale, last_blink_at, first_blink_count, manually_positioned, last_signal_at, details_md,
                   reschedule_for_min, kept_done_at)
values (@id, @parent_id, @title_md, @position, @created_at, @updated_at, @done_at, @deleted_at, @collapsed,
        @prev_sibling_id, @next_sibling_id, @left_with_id, @alert_period_override_min, @stale_base_at,
        @stale_since, @was_stale, @last_blink_at, @first_blink_count, @manually_positioned, @last_signal_at, @details_md,
        @reschedule_for_min, @kept_done_at)
on conflict(id) do update set
  parent_id = excluded.parent_id, title_md = excluded.title_md, position = excluded.position,
  created_at = excluded.created_at, updated_at = excluded.updated_at, done_at = excluded.done_at,
  deleted_at = excluded.deleted_at, collapsed = excluded.collapsed, prev_sibling_id = excluded.prev_sibling_id,
  next_sibling_id = excluded.next_sibling_id, left_with_id = excluded.left_with_id,
  alert_period_override_min = excluded.alert_period_override_min, stale_base_at = excluded.stale_base_at,
  stale_since = excluded.stale_since, was_stale = excluded.was_stale, last_blink_at = excluded.last_blink_at,
  first_blink_count = excluded.first_blink_count, manually_positioned = excluded.manually_positioned,
  last_signal_at = excluded.last_signal_at, details_md = excluded.details_md,
  reschedule_for_min = excluded.reschedule_for_min, kept_done_at = excluded.kept_done_at`;

/** The rows with these ids, as stored (015: a change's rows before it, to derive its history events). */
export function loadByIds(db: Database.Database, ids: readonly string[]): Task[] {
  const one = db.prepare("select * from tasks where id = ?");
  return [...new Set(ids)].flatMap((id) => {
    const r = one.get(id) as Row | undefined;
    return r === undefined ? [] : [toTask(r)];
  });
}

export function loadAll(db: Database.Database): Task[] {
  return (db.prepare("select * from tasks order by parent_id is not null, position").all() as Row[]).map(toTask);
}

/** One transaction: every change is saved, or none is. Throws SaveFailedError on any failure. */
export function applyChangeSet(db: Database.Database, changes: ChangeSet): void {
  const events = changes.events;
  const noEvents = events === undefined || events.inserts.length + events.updates.length + events.removals.length === 0;
  if (changes.upserts.length === 0 && changes.removals.length === 0 && noEvents) return;
  try {
    const upsert = db.prepare(UPSERT);
    const remove = db.prepare("delete from tasks where id = ?");
    db.transaction(() => {
      // Parents first, so a new subtask's foreign key and the one-level trigger see its parent.
      const ordered = [...changes.upserts].sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null));
      for (const t of ordered) upsert.run(toParams(t));
      if (faultActive("save")) throw new Error("VESTA_FAULT=save");
      // 015 FR-017: the history rows the change causes, in its transaction; a removed task's go with it (cascade).
      if (changes.events !== undefined) writeEvents(db, changes.events);
      for (const id of changes.removals) remove.run(id);
    })();
  } catch (err) {
    throw new SaveFailedError(err);
  }
}

/**
 * 008 research §4: writes rows whose parents may arrive after them, or change in the same write (an import's
 * winners and repairs). Pass 1 writes every row as top level; pass 2 sets the parents. The final state has
 * only top-level parents, so the one-level triggers and the foreign key never fire mid-way. Call inside a
 * transaction.
 */
export function upsertTasksTwoPass(db: Database.Database, rows: readonly Task[]): void {
  const upsert = db.prepare(UPSERT);
  const setParent = db.prepare("update tasks set parent_id = ? where id = ?");
  for (const t of rows) upsert.run({ ...toParams(t), parent_id: null });
  for (const t of rows) if (t.parentId !== null) setParent.run(t.parentId, t.id);
}
