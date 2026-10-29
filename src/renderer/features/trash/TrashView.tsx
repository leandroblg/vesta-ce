/**
 * Trash (FR-033, FR-034): deleted items newest first with kind and days left; Restore on every entry
 * (also subtasks that went with a parent); Delete permanently asks for a second click.
 */
import { useMemo } from "react";
import { reminderTrash } from "../../../domain/reminder-views";
import type { Task } from "../../../domain/task";
import { trashView } from "../../../domain/tree";
import { formatCleanupTime, formatDate, t } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";
import { DeleteForever, RestoreButton, TimeLeft, entryRowProps } from "../archive/entry-controls";
import { ViewHead } from "../archive/ViewHead";
import { plain } from "../../markdown/plain";
import { Markdown } from "../../markdown/Markdown";

export function TrashView() {
  // 018 FR-019: the notes name the Trash cleanup's time, or that it is off.
  const trash = useVesta((s) => s.cleanup.trash);
  const emptyLine = trash.on ? t("emptyTrash", { time: formatCleanupTime(trash.hours) }) : t("emptyTrashOff");
  const rows = useVesta((s) => s.tasks);
  const list = useMemo(() => trashView(Object.values(rows)), [rows]);
  const reminderRows = useVesta((s) => s.reminders);
  const reminders = useMemo(() => reminderTrash(Object.values(reminderRows)), [reminderRows]);
  return (
    <>
      <ViewHead title={t("trash")} note={trash.on ? t("trashNote", { time: formatCleanupTime(trash.hours) }) : t("trashNoteOff")} />
      {/* 014 FR-007 (PRD Q193): Reminders first, then Tasks, the main view's order; the keyboard follows the markup. */}
      <section className="division" aria-labelledby="trash-rem-h">
        <h2 className="div-h" id="trash-rem-h">
          {t("reminders")}
          <span className="count">{reminders.length}</span>
        </h2>
        {reminders.length === 0 ? (
          <div className="list empty-group">
            <div className="empty-state small">{emptyLine}</div>
          </div>
        ) : (
          <ul className="list" aria-labelledby="trash-rem-h" data-list="entries" tabIndex={-1}>
            {reminders.map((r) => (
              <li key={r.id} className="arow" data-kind="rem" data-id={r.id} {...entryRowProps(r.id, "rem")}>
                <div className="body">
                  <div className="title">
                    <Markdown md={r.textMd} scope="reminder" />
                  </div>
                  <div className="meta">{t("reminder") + t("metaSep") + t("deletedOn", { d: formatDate(r.deletedAt ?? 0) })}</div>
                </div>
                <div className="right">
                  <TimeLeft deletedAt={r.deletedAt ?? 0} />
                  <RestoreButton label={plain(r.textMd)} onRestore={() => void actions.restoreReminder(r.id)} />
                  <DeleteForever label={plain(r.textMd)} onDelete={() => actions.deleteReminderPermanently(r.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="division" aria-labelledby="trash-tasks-h">
        <h2 className="div-h" id="trash-tasks-h">
          {t("tasks")}
          <span className="count">{list.length}</span>
        </h2>
        {list.length === 0 ? (
          <div className="list empty-group">
            <div className="empty-state small">{emptyLine}</div>
          </div>
        ) : (
          <ul className="list" aria-labelledby="trash-tasks-h" data-list="entries" tabIndex={-1}>
            {list.map(({ task, parentTitle, subtasks }) => {
              const kind = task.parentId === null || parentTitle === null ? t("task") : t("subtaskOf", { p: parentTitle });
              const extra = subtasks.length > 0 ? t("metaSep") + t("withSubtasks", { n: subtasks.length }) : "";
              return (
                <TrashGroup key={task.id} task={task} meta={kind + t("metaSep") + t("deletedOn", { d: formatDate(task.deletedAt ?? 0) }) + extra} subtasks={subtasks} />
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function TrashGroup({ task, meta, subtasks }: { task: Task; meta: string; subtasks: Task[] }) {
  return (
    <>
      <li className="arow" data-id={task.id} data-kind="task" {...entryRowProps(task.id, "task")}>
        <div className="body">
          <div className="title">
            <Markdown md={task.titleMd} scope="title" />
          </div>
          <div className="meta">{meta}</div>
        </div>
        <div className="right">
          <TimeLeft deletedAt={task.deletedAt ?? 0} />
          <RestoreButton label={plain(task.titleMd)} onRestore={() => void actions.restore(task.id)} />
          <DeleteForever label={plain(task.titleMd)} onDelete={() => actions.deletePermanently(task.id)} />
        </div>
      </li>
      {subtasks.map((s) => (
        <li key={s.id} className="arow sub" data-id={s.id} data-kind="task" {...entryRowProps(s.id, "task")}>
          <div className="body">
            <div className="title">
              <Markdown md={s.titleMd} scope="title" />
            </div>
          </div>
          <div className="right">
            <RestoreButton label={plain(s.titleMd)} onRestore={() => void actions.restore(s.id)} />
          </div>
        </li>
      ))}
    </>
  );
}
