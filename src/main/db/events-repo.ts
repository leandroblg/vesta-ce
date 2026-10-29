/** 015 the `task_events` table (research §4, data-model.md "TaskEvent"): a task's history, written with its change. */
import type Database from "better-sqlite3";
import type { EventWrite, TaskEvent, TaskEventKind } from "../../domain/task-events";

interface Row {
  id: string;
  task_id: string;
  kind: TaskEventKind;
  at: number;
  detail: number | null;
  seq: number;
}

const COLS = "id, task_id, kind, at, detail, rowid as seq";
const toEvent = (r: Row): TaskEvent => ({ id: r.id, taskId: r.task_id, kind: r.kind, at: r.at, detail: r.detail, seq: r.seq });

/** Each task's latest event, by time then recording order (the override merge, PRD Q214). */
export function lastEvents(db: Database.Database, taskIds: readonly string[]): Map<string, TaskEvent> {
  const one = db.prepare(`select ${COLS} from task_events where task_id = ? order by at desc, rowid desc limit 1`);
  const out = new Map<string, TaskEvent>();
  for (const id of new Set(taskIds)) {
    const r = one.get(id) as Row | undefined;
    if (r !== undefined) out.set(id, toEvent(r));
  }
  return out;
}

/** One task's events in recording order (`tasks:history`). */
export function loadHistory(db: Database.Database, taskId: string): TaskEvent[] {
  return (db.prepare(`select ${COLS} from task_events where task_id = ? order by rowid`).all(taskId) as Row[]).map(toEvent);
}

/** Every event, by task, time and recording order (the export, research §6). */
export function loadAllEvents(db: Database.Database): TaskEvent[] {
  return (db.prepare(`select ${COLS} from task_events order by task_id, at, rowid`).all() as Row[]).map(toEvent);
}

/** The events with these ids, as stored (with their recording order), for a reply. */
export function loadEventsById(db: Database.Database, ids: readonly string[]): TaskEvent[] {
  const one = db.prepare(`select ${COLS} from task_events where id = ?`);
  return ids.flatMap((id) => {
    const r = one.get(id) as Row | undefined;
    return r === undefined ? [] : [toEvent(r)];
  });
}

/** Inserts, merged updates and removals; call inside the transaction of the change that causes them (FR-017). */
export function writeEvents(db: Database.Database, w: EventWrite): void {
  const insert = db.prepare("insert into task_events (id, task_id, kind, at, detail) values (@id, @taskId, @kind, @at, @detail)");
  const update = db.prepare("update task_events set at = @at, detail = @detail where id = @id");
  const remove = db.prepare("delete from task_events where id = ?");
  for (const e of w.inserts) insert.run({ id: e.id, taskId: e.taskId, kind: e.kind, at: e.at, detail: e.detail });
  for (const e of w.updates) update.run({ id: e.id, at: e.at, detail: e.detail });
  for (const id of w.removals) remove.run(id);
}

/** Imported events (research §6): a new id is added; an id that exists keeps the later `at`. Call inside a transaction. */
export function mergeEvents(db: Database.Database, events: readonly TaskEvent[]): void {
  const upsert = db.prepare(
    `insert into task_events (id, task_id, kind, at, detail) values (@id, @taskId, @kind, @at, @detail)
     on conflict(id) do update set at = excluded.at, detail = excluded.detail where excluded.at > task_events.at`,
  );
  for (const e of events) upsert.run({ id: e.id, taskId: e.taskId, kind: e.kind, at: e.at, detail: e.detail });
}
