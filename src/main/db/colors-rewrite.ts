/**
 * 011 FR-015 (research §13): the one-time rewrite of every stored span color to 8 digits. Only the markdown
 * columns change; `updated_at` is never touched, so the newest-edit merge of A7 is not disturbed by a change the
 * user did not make. The search triggers of 005 re-index the changed rows (their plain text is unchanged).
 */
import type Database from "better-sqlite3";
import { rewriteColors } from "../../domain/markdown/colors";
import type { Logger } from "../log";
import { loadColorsRewritten, saveColorsRewritten } from "./settings-repo";

/** One transaction; returns how many rows changed. Throws on a failed write, leaving the database as it was. */
export function rewriteStoredColors(db: Database.Database): { tasks: number; reminders: number } {
  return db.transaction(() => {
    let tasks = 0;
    let reminders = 0;
    const updateTask = db.prepare("update tasks set title_md = ?, details_md = ? where id = ?");
    for (const t of db.prepare("select id, title_md, details_md from tasks").all() as { id: string; title_md: string; details_md: string }[]) {
      const title = rewriteColors(t.title_md);
      const details = rewriteColors(t.details_md);
      if (title === t.title_md && details === t.details_md) continue;
      updateTask.run(title, details, t.id);
      tasks++;
    }
    const updateReminder = db.prepare("update reminders set text_md = ? where id = ?");
    for (const r of db.prepare("select id, text_md from reminders").all() as { id: string; text_md: string }[]) {
      const text = rewriteColors(r.text_md);
      if (text === r.text_md) continue;
      updateReminder.run(text, r.id);
      reminders++;
    }
    return { tasks, reminders };
  })();
}

/**
 * The start step: runs once, after the migrations (so after the pre-upgrade backup), only when the data folder is
 * writable. A failure is logged and retried at the next start, since the flag is saved only after a success.
 */
export function runColorRewrite(
  db: Database.Database,
  ctx: { writable: boolean; now: number; log: Pick<Logger, "info" | "error"> },
): void {
  if (!ctx.writable || loadColorsRewritten(db)) return;
  const t0 = performance.now();
  try {
    const counts = rewriteStoredColors(db);
    saveColorsRewritten(db, ctx.now);
    ctx.log.info("markdown.colors-rewritten", { tasks: counts.tasks, reminders: counts.reminders, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    ctx.log.error("markdown.colors-rewrite-failed", { message: err instanceof Error ? err.message : String(err) });
  }
}
