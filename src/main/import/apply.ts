/**
 * Writing an import (008 research §4; FR-031, FR-033, FR-034, FR-037): one transaction for the tasks, the
 * reminders, the settings and the new files' rows. The files themselves were copied before it (reader.ts), so a
 * failure leaves at most files without rows, which the purge removes (005 design).
 */
import type Database from "better-sqlite3";
import type { MergePlan } from "../../domain/export/merge";
import { assetMimeType, assetRefs } from "../../domain/markdown/assets";
import { hashOfRef } from "../../domain/purge";
import { faultActive } from "../faults";
import { applyPeriodChange } from "../../domain/period-change";
import { loadAlertSettings, writeCleanupChangedAt } from "../db/settings-repo";
import { loadAll, upsertTasksTwoPass } from "../db/tasks-repo";
import { mergeEvents, writeEvents } from "../db/events-repo";
import { deriveEvents } from "../../domain/task-events";
import { randomUUID } from "node:crypto";

const REMINDER_UPSERT = `
insert into reminders (id, text_md, position, created_at, updated_at, done_at, deleted_at, prev_sibling_id, next_sibling_id, kept_done_at)
values (@id, @textMd, @position, @createdAt, @updatedAt, @doneAt, @deletedAt, @prevSiblingId, @nextSiblingId, @keptDoneAt)
on conflict(id) do update set
  text_md = excluded.text_md, position = excluded.position, created_at = excluded.created_at,
  updated_at = excluded.updated_at, done_at = excluded.done_at, deleted_at = excluded.deleted_at,
  prev_sibling_id = excluded.prev_sibling_id, next_sibling_id = excluded.next_sibling_id, kept_done_at = excluded.kept_done_at`;

const SETTING_UPSERT = `
insert into settings (key, value, updated_at) values (?, ?, ?)
on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`;

/**
 * Throws on any failure; the transaction then leaves every table as it was. `firstBytes` (010 M2, FR-004) gives each
 * copied file's first bytes, so the stored type is Vesta's own, never the export's declared one.
 */
export function applyImport(db: Database.Database, plan: MergePlan, now: number, firstBytes?: ReadonlyMap<string, Uint8Array>): void {
  db.transaction(() => {
    upsertTasksTwoPass(db, plan.taskUpserts);
    if (faultActive("import-write")) throw new Error("VESTA_FAULT=import-write");
    // 015 FR-023: the file's history events, merged by id (the later `at` wins); the import records none of its own.
    mergeEvents(db, plan.eventUpserts);
    const reminder = db.prepare(REMINDER_UPSERT);
    for (const r of plan.reminderUpserts) reminder.run(r);
    const periodBefore = loadAlertSettings(db).settings.alertPeriodMin;
    const setting = db.prepare(SETTING_UPSERT);
    for (const s of plan.settingUpserts) setting.run(s.key, JSON.stringify(s.value), s.updatedAt);
    // 018 FR-016a: an accepted cleanup row is a saved change, so that cleanup waits its hour from the import (FR-020b).
    for (const which of new Set(plan.settingUpserts.flatMap((s) => (s.key.startsWith("archiveCleanup") ? ["archive" as const] : s.key.startsWith("trashCleanup") ? ["trash" as const] : []))))
      writeCleanupChangedAt(db, which, now);
    // 012 FR-028c: a changed global alert period un-stales the tasks it no longer makes late, in this transaction.
    const after = loadAlertSettings(db).settings;
    if (after.alertPeriodMin !== periodBefore) {
      const all = loadAll(db);
      const upserts = applyPeriodChange(all, after, now).upserts;
      upsertTasksTwoPass(db, upserts);
      // 015 FR-017 (PRD Q216): the tasks the imported period un-stales record "No longer stale".
      writeEvents(db, deriveEvents(all, { upserts, removals: [] }, { now, newId: randomUUID, origin: "period", lastEvents: new Map(), toleranceMin: after.rescheduleToleranceMin }));
    }
    const insert = db.prepare(
      "insert or ignore into assets (sha256, ext, mime_type, size, created_at, removed_at) values (?, ?, ?, ?, ?, null)",
    );
    for (const a of plan.assetsToAdd) insert.run(a.sha256, a.ext, assetMimeType(firstBytes?.get(a.sha256) ?? new Uint8Array(0), a.ext), a.size, now);
    // FR-034: a file tagged "removed from system" that an imported item references is in use again.
    const untag = db.prepare("update assets set removed_at = null where sha256 = ? and removed_at is not null");
    const refs = new Set<string>();
    for (const t of plan.taskUpserts) for (const ref of [...assetRefs(t.titleMd), ...assetRefs(t.detailsMd)]) refs.add(hashOfRef(ref));
    for (const r of plan.reminderUpserts) for (const ref of assetRefs(r.textMd)) refs.add(hashOfRef(ref));
    for (const h of refs) untag.run(h);
  })();
}
