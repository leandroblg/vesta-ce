/**
 * Which tasks the details panel can show in each view (011 FR-022b): active ones in the main view, done ones in
 * the Archive (read-only), deleted ones in the Trash (read-only). The panel closes when its task leaves the view
 * it was opened in (a restore, a delete forever, a purge, or 005 FR-004's done or delete in the main view).
 */
import { isActive, type Task } from "../../domain/task";

export type PanelView = "tasks" | "archive" | "trash";

export function fitsView(task: Task, view: PanelView): boolean {
  if (view === "tasks") return isActive(task);
  if (view === "archive") return task.doneAt !== null && task.deletedAt === null;
  return task.deletedAt !== null;
}
