/**
 * Archive (FR-031, FR-032): done items newest first, each with Restore and, from 018 (FR-009, PRD Q272), Delete, which
 * moves it to the Trash; a right-click opens the same two commands.
 */
import { useMemo, useRef, useState, type MouseEvent } from "react";
import { formatAge } from "../../../domain/age";
import { reminderArchive } from "../../../domain/reminder-views";
import { archiveView } from "../../../domain/tree";
import type { Task } from "../../../domain/task";
import { ageUnits, formatCleanupTime, formatDate, t } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";
import { ContextMenu } from "../../components/ContextMenu";
import { Close, Restore } from "../../components/icons";
import { DeleteButton, RestoreButton, entryRowProps } from "./entry-controls";
import { ViewHead } from "./ViewHead";
import { plain } from "../../markdown/plain";
import { Markdown } from "../../markdown/Markdown";

function Row({ task, sub, context, onMenu }: { task: Task; sub: boolean; context: string | null; onMenu: OpenMenu }) {
  return (
    <li
      className={sub ? "arow sub" : "arow"}
      data-id={task.id}
      data-kind="task"
      {...entryRowProps(task.id, "task")}
      onContextMenu={(e) => {
        onMenu(e, { id: task.id, kind: "task", label: plain(task.titleMd) });
      }}
    >
      <div className="body">
        {context !== null && <div className="ctx">{t("parentCtx", { p: context })}</div>}
        <div className="title">
          <Markdown md={task.titleMd} scope="title" />
        </div>
        <div className="meta">{t("doneOn", { d: formatDate(task.doneAt ?? 0) })}</div>
      </div>
      <div className="right">
        {task.wasStale && (
          // A done task that was ever stale: no ember, a grey pill in sentence case with its total time (003 FR-040).
          <span className="gtag pill grey">
            <b>{t("stale")}</b>
            {t("metaSep")}
            {t("totalTime", { t: formatAge((task.doneAt ?? 0) - task.createdAt, ageUnits()) })}
          </span>
        )}
        <RestoreButton label={plain(task.titleMd)} onRestore={() => void actions.restore(task.id)} />
        {/* Taken-along subtasks go with their parent; they keep Restore only, as in the Trash. */}
        {!sub && <DeleteButton label={plain(task.titleMd)} onDelete={() => void actions.delete(task.id)} />}
      </div>
    </li>
  );
}

/** The entry a right-click opened the menu for, at the pointer. */
interface MenuTarget {
  id: string;
  kind: "task" | "rem";
  label: string;
  x: number;
  y: number;
  back: HTMLElement;
}
type OpenMenu = (e: MouseEvent<HTMLLIElement>, entry: Pick<MenuTarget, "id" | "kind" | "label">) => void;

function EntryMenu({ target, onClose }: { target: MenuTarget; onClose: () => void }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const restore = () => void (target.kind === "task" ? actions.restore(target.id) : actions.restoreReminder(target.id));
  const remove = () => void (target.kind === "task" ? actions.delete(target.id) : actions.deleteReminder(target.id));
  return (
    <>
      <span ref={anchor} className="point-anchor" style={{ left: target.x, top: target.y }} aria-hidden="true" />
      <ContextMenu
        label={target.label}
        items={[
          { key: "restore", label: t("menuRestore"), icon: <Restore />, onSelect: restore },
          { key: "del", label: t("menuMoveToTrash"), icon: <Close />, danger: true, separatorBefore: true, onSelect: remove },
        ]}
        anchorRef={anchor}
        placement="at-point"
        onClose={() => {
          onClose();
          if (target.back.isConnected) target.back.focus({ preventScroll: true });
        }}
      />
    </>
  );
}

export function ArchiveView() {
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const openMenu: OpenMenu = (e, entry) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    setMenu({ ...entry, x: e.clientX, y: e.clientY, back: e.currentTarget });
  };
  // 018 FR-019: the notes name the Archive cleanup's time, or that it is off.
  const cleanup = useVesta((s) => s.cleanup.archive);
  const emptyLine = cleanup.on ? t("emptyArchive", { time: formatCleanupTime(cleanup.hours) }) : t("emptyArchiveOff");
  const rows = useVesta((s) => s.tasks);
  const list = useMemo(() => archiveView(Object.values(rows)), [rows]);
  const reminderRows = useVesta((s) => s.reminders);
  const reminders = useMemo(() => reminderArchive(Object.values(reminderRows)), [reminderRows]);
  return (
    <>
      <ViewHead title={t("archive")} note={cleanup.on ? t("archiveNote", { time: formatCleanupTime(cleanup.hours) }) : t("archiveNoteOff")} />
      {/* 014 FR-007 (PRD Q193): Reminders first, then Tasks, the main view's order; the keyboard follows the markup. */}
      <section className="division" aria-labelledby="archive-rem-h">
        <h2 className="div-h" id="archive-rem-h">
          {t("reminders")}
          <span className="count">{reminders.length}</span>
        </h2>
        {reminders.length === 0 ? (
          <div className="list empty-group">
            <div className="empty-state small">{emptyLine}</div>
          </div>
        ) : (
          <ul className="list" aria-labelledby="archive-rem-h" data-list="entries" tabIndex={-1}>
            {reminders.map((r) => (
              <li
                key={r.id}
                className="arow"
                data-kind="rem"
                data-id={r.id}
                {...entryRowProps(r.id, "rem")}
                onContextMenu={(e) => {
                  openMenu(e, { id: r.id, kind: "rem", label: plain(r.textMd) });
                }}
              >
                <div className="body">
                  <div className="title">
                    <Markdown md={r.textMd} scope="reminder" />
                  </div>
                  <div className="meta">{t("doneOn", { d: formatDate(r.doneAt ?? 0) })}</div>
                </div>
                <div className="right">
                  <RestoreButton label={plain(r.textMd)} onRestore={() => void actions.restoreReminder(r.id)} />
                  <DeleteButton label={plain(r.textMd)} onDelete={() => void actions.deleteReminder(r.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="division" aria-labelledby="archive-tasks-h">
        <h2 className="div-h" id="archive-tasks-h">
          {t("tasks")}
          <span className="count">{list.length}</span>
        </h2>
        {list.length === 0 ? (
          <div className="list empty-group">
            <div className="empty-state small">{emptyLine}</div>
          </div>
        ) : (
          <ul className="list" aria-labelledby="archive-tasks-h" data-list="entries" tabIndex={-1}>
            {list.map((e) => (
              <ArchiveGroup key={e.task.id} task={e.task} context={e.parentTitle} subtasks={e.subtasks} onMenu={openMenu} />
            ))}
          </ul>
        )}
      </section>
      {menu !== null && (
        <EntryMenu
          target={menu}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
    </>
  );
}

function ArchiveGroup({ task, context, subtasks, onMenu }: { task: Task; context: string | null; subtasks: Task[]; onMenu: OpenMenu }) {
  return (
    <>
      <Row task={task} sub={false} context={context} onMenu={onMenu} />
      {subtasks.map((s) => (
        <Row key={s.id} task={s} sub context={null} onMenu={onMenu} />
      ))}
    </>
  );
}
