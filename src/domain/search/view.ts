// What the main view and the "Matches in Archive and Trash" section show during a search
// (006 FR-005 to FR-010, FR-017, FR-018; research §6). The order comes from the existing views (003, 004).
import type { Reminder } from "../reminder";
import type { Task } from "../task";
import type { TreeNode } from "../tree";

export interface MatchInfo {
  inTitle: boolean;
  excerpt: string | null;
}

type Kinded = { kind: "task"; row: Task } | { kind: "reminder"; row: Reminder };

export type ElsewhereRow = Kinded & {
  id: string;
  /** Completion or deletion time. */
  at: number;
  /** The parent's title while its row exists (any state), for a subtask. */
  parentTitle: string | null;
  match: MatchInfo;
};

export interface SearchViewInput {
  active: boolean;
  /** The unfiltered active tree (activeTree), in display order. */
  tree: readonly TreeNode[];
  /** The active reminders in display order (activeReminders). */
  reminders: readonly Reminder[];
  allTasks: readonly Task[];
  allReminders: readonly Reminder[];
  matches: ReadonlyMap<string, MatchInfo>;
  /** Items created or edited during this search: shown even when they do not match (FR-009). */
  pinned: ReadonlySet<string>;
  includeArchiveTrash: boolean;
}

export interface SearchView {
  tree: TreeNode[];
  reminders: Reminder[];
  tasksNoMatches: boolean;
  remindersNoMatches: boolean;
  elsewhere: ElsewhereRow[];
  match: (id: string) => MatchInfo | null;
}

const atOf = (row: Task | Reminder): number => row.doneAt ?? row.deletedAt ?? 0;
const leftWith = (e: Kinded): string | null => (e.kind === "task" ? e.row.leftWithId : null);

/** Newest first; on equal dates a parent before the subtasks that left with it (by position), then newest created. */
export function elsewhereOrder<T extends Kinded>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const byDate = atOf(b.row) - atOf(a.row);
    if (byDate !== 0) return byDate;
    if (leftWith(b) === a.row.id) return -1;
    if (leftWith(a) === b.row.id) return 1;
    const la = leftWith(a);
    if (la !== null && la === leftWith(b)) return a.row.position - b.row.position;
    return b.row.createdAt - a.row.createdAt || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0);
  });
}

export function searchView(input: SearchViewInput): SearchView {
  const match = (id: string): MatchInfo | null => input.matches.get(id) ?? null;
  if (!input.active) {
    return { tree: [...input.tree], reminders: [...input.reminders], tasksNoMatches: false, remindersNoMatches: false, elsewhere: [], match };
  }
  const shown = (id: string): boolean => input.matches.has(id) || input.pinned.has(id);

  const tree = input.tree.flatMap((node) => {
    const subtasks = node.subtasks.filter((s) => shown(s.id));
    return shown(node.task.id) || subtasks.length > 0 ? [{ task: node.task, subtasks }] : [];
  });
  const reminders = input.reminders.filter((r) => shown(r.id));

  let elsewhere: ElsewhereRow[] = [];
  if (input.includeArchiveTrash) {
    const byId = new Map(input.allTasks.map((t) => [t.id, t]));
    const rows: ElsewhereRow[] = [];
    for (const t of input.allTasks) {
      const m = match(t.id);
      if (m === null || (t.doneAt === null && t.deletedAt === null)) continue;
      const parentTitle = t.parentId === null ? null : (byId.get(t.parentId)?.titleMd ?? null);
      rows.push({ kind: "task", row: t, id: t.id, at: atOf(t), parentTitle, match: m });
    }
    for (const r of input.allReminders) {
      const m = match(r.id);
      if (m === null || (r.doneAt === null && r.deletedAt === null)) continue;
      rows.push({ kind: "reminder", row: r, id: r.id, at: atOf(r), parentTitle: null, match: m });
    }
    elsewhere = elsewhereOrder(rows);
  }

  return {
    tree,
    reminders,
    tasksNoMatches: input.tree.length > 0 && tree.length === 0,
    remindersNoMatches: input.reminders.length > 0 && reminders.length === 0,
    elsewhere,
    match,
  };
}
