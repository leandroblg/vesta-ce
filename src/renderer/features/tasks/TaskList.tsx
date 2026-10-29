/** The task list: active tasks with their subtasks, then the empty card (FR-005, FR-011, FR-012). */
import { Fragment, memo, useEffect, useMemo, useRef } from "react";
import { isPinned } from "../../../domain/alerts";
import { isActive, type Task } from "../../../domain/task";
import { activeTree, type TreeNode } from "../../../domain/tree";
import { searchView, type MatchInfo } from "../../../domain/search/view";
import { useVirtualRows } from "../search/useVirtualRows";
import { t } from "../../i18n/t";
import { NEW_TASK, actions, newSubKey, useVesta, type FrozenNode } from "../../store/store";
import { attachDrag } from "./drag/controller";
import { NewCard } from "./NewCard";
import { useComboLabel } from "../../keyboard/hint";
import { TaskCard } from "./TaskCard";
import { Hearth } from "../../components/icons";

/** The live tree still has the order frozen at drag start (shown subtasks only). */
function sameOrder(live: readonly TreeNode[], frozen: readonly FrozenNode[]): boolean {
  return (
    live.length === frozen.length &&
    live.every((n, i) => {
      const f = frozen[i] as FrozenNode;
      const shown = n.task.collapsed ? [] : n.subtasks;
      return n.task.id === f.id && shown.length === f.subs.length && shown.every((s, j) => s.id === f.subs[j]);
    })
  );
}

/**
 * During a drag the list keeps the order it had at drag start, with current row data (004 FR-012).
 * A collapsed parent keeps its live (hidden) subtasks, so its stale-subtask marker stays right.
 */
function frozenTree(frozen: readonly FrozenNode[], live: readonly TreeNode[], rows: Readonly<Record<string, Task>>): TreeNode[] {
  const byId = new Map(live.map((n) => [n.task.id, n]));
  const active = (id: string): Task[] => {
    const row = rows[id];
    return row !== undefined && isActive(row) ? [row] : [];
  };
  return frozen.flatMap((f) => {
    const node = byId.get(f.id);
    if (node === undefined) return [];
    return [{ task: node.task, subtasks: node.task.collapsed ? node.subtasks : f.subs.flatMap(active) }];
  });
}

type Excerpts = ReadonlyMap<string, string>;

/** One row of a virtualized filtered list: a top-level task, a subtask, or a parent's subtask empty card. */
interface Row {
  key: string;
  kind: "task" | "sub" | "newsub";
  task: Task;
}

/**
 * One top-level task with its subtasks and its subtask empty card; memoized for large lists (SC-004).
 * While searching (006 FR-006, FR-007) `node.subtasks` holds only the shown subtasks and they show even under
 * a collapsed parent; `allSubs` keeps the parent's markers right.
 */
const TaskNode = memo(function TaskNode({
  node,
  allSubs,
  inGroup,
  searching,
  excerpts,
  matches,
}: {
  node: TreeNode;
  allSubs: readonly Task[];
  inGroup: boolean;
  searching: boolean;
  excerpts: Excerpts;
  matches: ReadonlyMap<string, MatchInfo>;
}) {
  // 007: re-render on a language switch, which memo would skip (research §4).
  useVesta((s) => s.language);
  const { task, subtasks } = node;
  return (
    <Fragment>
      <TaskCard
        task={task}
        isSub={false}
        hasSubs={allSubs.length > 0}
        staleSub={allSubs.some((s) => s.staleSince !== null)}
        inGroup={inGroup}
        excerpt={excerpts.get(task.id) ?? null}
        highlight={searching && matches.has(task.id)}
      />
      {(searching || !task.collapsed) &&
        subtasks.map((sub) => (
          <TaskCard
            key={sub.id}
            task={sub}
            isSub
            hasSubs={false}
            staleSub={false}
            inGroup={false}
            excerpt={excerpts.get(sub.id) ?? null}
            highlight={searching && matches.has(sub.id)}
          />
        ))}
      <NewCard editingKey={newSubKey(task.id)} kind="sub" placeholder={t("newSubPh")} onCreate={(title) => actions.create(title, task.id)} />
    </Fragment>
  );
});

export function TaskList() {
  // 007 FR-037: the hint shows the current New task combination.
  const newTaskKey = useComboLabel("newTask");
  const rows = useVesta((s) => s.tasks);
  const editingKey = useVesta((s) => s.editingKey);
  const menuFor = useVesta((s) => s.menuFor);
  const overrideFor = useVesta((s) => s.overrideFor);
  const frozen = useVesta((s) => (s.drag?.kind === "task" ? s.drag.frozen : null));
  const list = useRef<HTMLUListElement>(null);
  // A row whose editor, menu or override panel is open keeps its place until it closes (003 FR-025).
  const exempt = useMemo(
    () => new Set([editingKey, menuFor, overrideFor].filter((id): id is string => id !== null && id in rows)),
    [rows, editingKey, menuFor, overrideFor],
  );
  const live = useMemo(() => activeTree(Object.values(rows), { exempt }), [rows, exempt]);
  const tree = useMemo(() => (frozen === null || sameOrder(live, frozen) ? live : frozenTree(frozen, live, rows)), [live, frozen, rows]);
  // Granular selectors: typing alone (before results arrive) re-renders nothing heavy (006 SC-001).
  const active = useVesta((s) => s.search.active);
  // Filter only once results have arrived (session.applied): the first keystroke keeps the list as it is.
  const filtering = useVesta((s) => s.search.active && s.search.session.applied);
  const matches = useVesta((s) => s.search.session.matches);
  const pinned = useVesta((s) => s.search.session.pinned);
  const slow = useVesta((s) => s.search.session.slow);
  const query = useVesta((s) => s.search.text.trim());
  // 006 FR-005 to FR-010: while searching, only matches (and pinned items) with their parents.
  const view = useMemo(
    () => searchView({ active: filtering, tree, reminders: [], allTasks: [], allReminders: [], matches, pinned, includeArchiveTrash: false }),
    [filtering, tree, matches, pinned],
  );
  const allSubs = useMemo(() => new Map(tree.map((n) => [n.task.id, n.subtasks])), [tree]);
  const excerpts = useMemo(() => {
    const out = new Map<string, string>();
    if (!filtering) return out;
    for (const [id, m] of matches) if (!m.inTitle && m.excerpt !== null) out.set(id, m.excerpt);
    return out;
  }, [filtering, matches]);
  const shown = view.tree;
  // 006 SC-001: a filtered list of more than 100 rows renders only the rows near the viewport.
  const flat = useMemo(() => {
    const out: Row[] = [];
    if (!filtering) return out;
    for (const node of shown) {
      out.push({ key: node.task.id, kind: "task", task: node.task });
      for (const sub of node.subtasks) out.push({ key: sub.id, kind: "sub", task: sub });
      if (editingKey === newSubKey(node.task.id)) out.push({ key: newSubKey(node.task.id), kind: "newsub", task: node.task });
    }
    return out;
  }, [filtering, shown, editingKey]);
  const v = useVirtualRows(flat, (r) => r.key, filtering, list);

  useEffect(() => {
    const el = list.current;
    return el === null ? undefined : attachDrag(el, "task");
  }, []);

  return (
    <section aria-labelledby="tasks-h">
      <div className="sec-head">
        <div className="sec-title">
          <h2 id="tasks-h">{t("tasks")}</h2>
          <span className="count">{live.length}</span>
        </div>
      </div>
      <ul
        className={active ? "list searching" : "list"}
        aria-label={t("tasks")}
        ref={list}
        data-list="tasks"
        tabIndex={-1}
      >
        {v.virtual ? (
          <>
            {v.before > 0 && <li key="v:before" className="vspacer" aria-hidden="true" style={{ height: v.before }} />}
            {v.rows.map((r, i) =>
              r.kind === "newsub" ? (
                <NewCard key={`v:${r.key}`} editingKey={r.key} kind="sub" placeholder={t("newSubPh")} onCreate={(title) => actions.create(title, r.task.id)} />
              ) : (
                <TaskCard
                  key={`v:${r.key}`}
                  task={r.task}
                  isSub={r.kind === "sub"}
                  hasSubs={r.kind === "task" && (allSubs.get(r.task.id)?.length ?? 0) > 0}
                  staleSub={r.kind === "task" && (allSubs.get(r.task.id) ?? []).some((s) => s.staleSince !== null)}
                  inGroup={r.kind === "task" && isPinned(r.task) && !exempt.has(r.task.id)}
                  excerpt={excerpts.get(r.task.id) ?? null}
                  highlight={matches.has(r.task.id)}
                  setPos={{ pos: v.start + i + 1, size: v.total }}
                />
              ),
            )}
            {v.after > 0 && <li key="v:after" className="vspacer" aria-hidden="true" style={{ height: v.after }} />}
          </>
        ) : (
          shown.map((node) => (
            <TaskNode
              key={node.task.id}
              node={node}
              allSubs={allSubs.get(node.task.id) ?? node.subtasks}
              inGroup={isPinned(node.task) && !exempt.has(node.task.id)}
              searching={filtering}
              excerpts={excerpts}
              matches={matches}
            />
          ))
        )}
        {view.tasksNoMatches && !slow && (
          <li key="no-matches" className="no-matches">
            {t("noMatches", { q: query })}
          </li>
        )}
        {tree.length === 0 && !active && (
          // Identity §11: the mark in tertiary color and one warm sentence; the footer row below adds the first task.
          <li key="empty" className="empty-state" data-testid="empty-tasks">
            <Hearth flame="var(--flame)" className="empty-mark" />
            <b>{t("emptyTasksTitle")}</b>
            <span>{t("emptyTasks", { k: newTaskKey })}</span>
          </li>
        )}
        <NewCard key="new-task" editingKey={NEW_TASK} kind="task" placeholder={t("newTaskPh")} onCreate={(title) => actions.create(title, null)} />
      </ul>
    </section>
  );
}
