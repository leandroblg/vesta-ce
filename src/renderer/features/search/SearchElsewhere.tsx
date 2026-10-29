/**
 * "Matches in Archive and Trash" (006 FR-016 to FR-019): every done or deleted item that matches, newest
 * first, below the Task list while the checkbox is ticked. Restore works as in the Archive and Trash views;
 * there is no permanent delete, and a title click does nothing except follow a link.
 */
import { memo, useMemo, useRef } from "react";
import { useVirtualRows } from "./useVirtualRows";
import { searchView, type ElsewhereRow } from "../../../domain/search/view";
import { formatDate, t } from "../../i18n/t";
import { Markdown } from "../../markdown/Markdown";
import { plain } from "../../markdown/plain";
import { actions, useVesta } from "../../store/store";
import { RestoreButton, TimeLeft } from "../archive/entry-controls";
import { Excerpt } from "./Excerpt";

type RowProps = { row: ElsewhereRow; setPos: { pos: number; size: number } | null };
const sameRow = (a: RowProps, b: RowProps) =>
  a.setPos?.pos === b.setPos?.pos &&
  a.setPos?.size === b.setPos?.size &&
  a.row.row === b.row.row &&
  a.row.parentTitle === b.row.parentTitle &&
  a.row.match.inTitle === b.row.match.inTitle &&
  a.row.match.excerpt === b.row.match.excerpt;

const Row = memo(function Row({ row, setPos }: { row: ElsewhereRow; setPos: { pos: number; size: number } | null }) {
  // 007: re-render on a language switch, which memo would skip (research §4).
  useVesta((s) => s.language);
  const md = row.kind === "task" ? row.row.titleMd : row.row.textMd;
  const inTrash = row.row.deletedAt !== null;
  const date = inTrash ? t("deletedOn", { d: formatDate(row.row.deletedAt ?? 0) }) : t("doneOn", { d: formatDate(row.row.doneAt ?? 0) });
  const excerpt = row.match.inTitle ? null : row.match.excerpt;
  return (
    <li
      className="arow"
      data-id={row.id}
      data-kind={row.kind === "task" ? "task-elsewhere" : "rem-elsewhere"}
      aria-posinset={setPos?.pos}
      aria-setsize={setPos?.size}
    >
      <div className="body">
        {row.parentTitle !== null && <div className="ctx">{t("parentCtx", { p: plain(row.parentTitle) })}</div>}
        <div className="title" data-hl="">
          <Markdown md={md} scope={row.kind === "task" ? "title" : "reminder"} />
        </div>
        {excerpt !== null && <Excerpt text={excerpt} />}
        <div className="meta">{(row.kind === "reminder" ? t("reminder") + t("metaSep") : "") + date}</div>
      </div>
      <div className="right">
        {inTrash && <TimeLeft deletedAt={row.row.deletedAt ?? 0} />}
        <span className="kind">{inTrash ? t("trashTag") : t("archiveTag")}</span>
        <RestoreButton
          label={plain(md)}
          onRestore={() => {
            if (row.kind === "task") void actions.restore(row.id);
            else void actions.restoreReminder(row.id);
          }}
        />
      </div>
    </li>
  );
}, sameRow);

export function SearchElsewhere() {
  // Shown once results have arrived (session.applied), like the filtered lists.
  const active = useVesta((s) => s.search.active && s.search.session.applied);
  const include = useVesta((s) => s.search.includeArchiveTrash);
  const matches = useVesta((s) => s.search.session.matches);
  const slow = useVesta((s) => s.search.session.slow);
  const query = useVesta((s) => s.search.text.trim());
  const tasks = useVesta((s) => s.tasks);
  const reminders = useVesta((s) => s.reminders);
  const rows = useMemo(
    () =>
      searchView({
        active,
        tree: [],
        reminders: [],
        allTasks: Object.values(tasks),
        allReminders: Object.values(reminders),
        matches,
        pinned: new Set(),
        includeArchiveTrash: include,
      }).elsewhere,
    [active, include, matches, tasks, reminders],
  );
  const listRef = useRef<HTMLUListElement>(null);
  // 006 SC-001: more than 100 rows render only those near the viewport; every match stays listed (FR-018).
  const v = useVirtualRows(rows, (r) => r.id, active && include, listRef);
  if (!active || !include) return null;
  return (
    <section className="elsewhere" aria-labelledby="elsewhere-h">
      <h2 className="div-h" id="elsewhere-h">
        {t("matchesElsewhere")}
      </h2>
      {rows.length === 0 ? (
        // While the index is being prepared there is nothing to report yet ("Preparing search…" shows).
        slow ? null : (
          <div className="list empty-group">
            <div className="empty-state small">{t("noMatches", { q: query })}</div>
          </div>
        )
      ) : (
        <ul className="list" aria-labelledby="elsewhere-h" ref={listRef}>
          {v.before > 0 && <li className="vspacer" aria-hidden="true" style={{ height: v.before }} />}
          {v.rows.map((r, i) => (
            <Row key={r.id} row={r} setPos={v.virtual ? { pos: v.start + i + 1, size: v.total } : null} />
          ))}
          {v.after > 0 && <li className="vspacer" aria-hidden="true" style={{ height: v.after }} />}
        </ul>
      )}
    </section>
  );
}
