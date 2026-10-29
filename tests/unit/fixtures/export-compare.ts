/**
 * The single definition of "identical" for 008's SC-001, SC-009 and SC-010 (research §12): every FR-012 field of
 * every task and reminder, every exported setting with its change time, and every stored file's bytes by hash.
 * Machine-local state (FR-016: backups and their records, the search index, a file's local insert time and
 * "removed from system" tag) is not part of a snapshot.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { EXPORTED_SETTING_KEYS } from "../../../src/domain/export/format";
import type { Reminder } from "../../../src/domain/reminder";
import type { Task } from "../../../src/domain/task";
import { loadReminders } from "../../../src/main/db/reminders-repo";
import { loadAll } from "../../../src/main/db/tasks-repo";

export interface DataSnapshot {
  tasks: Task[];
  reminders: Reminder[];
  settings: { key: string; value: unknown; updatedAt: number }[];
  /** 015 FR-023: every history event, without its local recording order. */
  events: { id: string; taskId: string; kind: string; at: number; detail: number | null }[];
  /** sha256 → ext, mime type and the file's own sha256 (so bytes compare by content). */
  files: Record<string, { ext: string; mimeType: string; size: number; contentHash: string | null }>;
}

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function readSnapshot(db: Database.Database, dataDir: string): DataSnapshot {
  const settings = (db.prepare("select key, value, updated_at as updatedAt from settings").all() as { key: string; value: string; updatedAt: number }[])
    .filter((r) => (EXPORTED_SETTING_KEYS as readonly string[]).includes(r.key))
    .map((r) => ({ key: r.key, value: JSON.parse(r.value) as unknown, updatedAt: r.updatedAt }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  const files: DataSnapshot["files"] = {};
  for (const row of db.prepare("select sha256, ext, mime_type as mimeType, size from assets").all() as {
    sha256: string;
    ext: string;
    mimeType: string;
    size: number;
  }[]) {
    const path = join(dataDir, "assets", row.ext === "" ? row.sha256 : `${row.sha256}.${row.ext}`);
    const contentHash = existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
    files[row.sha256] = { ext: row.ext, mimeType: row.mimeType, size: row.size, contentHash };
  }
  const events = db.prepare("select id, task_id as taskId, kind, at, detail from task_events order by id").all() as DataSnapshot["events"];
  return { tasks: byId(loadAll(db)), reminders: byId(loadReminders(db)), settings, events, files };
}

/** Every difference, as readable lines; empty means identical. */
export function snapshotDiff(a: DataSnapshot, b: DataSnapshot, options: { ignoreFilesOnlyIn?: "b" } = {}): string[] {
  const out: string[] = [];
  const rows = <T extends { id: string }>(name: string, xs: T[], ys: T[]) => {
    const ya = new Map(ys.map((y) => [y.id, y]));
    for (const x of xs) {
      const y = ya.get(x.id);
      if (y === undefined) out.push(`${name} ${x.id}: only in the first`);
      else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${name} ${x.id}: ${JSON.stringify(x)} ≠ ${JSON.stringify(y)}`);
      ya.delete(x.id);
    }
    for (const id of ya.keys()) out.push(`${name} ${id}: only in the second`);
  };
  rows("task", a.tasks, b.tasks);
  rows("reminder", a.reminders, b.reminders);
  rows("event", a.events, b.events);
  if (JSON.stringify(a.settings) !== JSON.stringify(b.settings)) out.push(`settings: ${JSON.stringify(a.settings)} ≠ ${JSON.stringify(b.settings)}`);
  for (const [sha, fa] of Object.entries(a.files)) {
    const fb = b.files[sha];
    if (fb === undefined) out.push(`file ${sha}: only in the first`);
    else if (JSON.stringify(fa) !== JSON.stringify(fb)) out.push(`file ${sha}: ${JSON.stringify(fa)} ≠ ${JSON.stringify(fb)}`);
  }
  if (options.ignoreFilesOnlyIn !== "b") for (const sha of Object.keys(b.files)) if (!(sha in a.files)) out.push(`file ${sha}: only in the second`);
  return out;
}

export function snapshotEquals(a: DataSnapshot, b: DataSnapshot): boolean {
  return snapshotDiff(a, b).length === 0;
}
