/**
 * Screen-reader announcements for the search (006 FR-023): the number of results 500 ms after the last
 * change, and "Preparing search…" while results wait (slow reply or index still being prepared).
 */
import { searchView } from "../../../domain/search/view";
import { activeTree } from "../../../domain/tree";
import { activeReminders } from "../../../domain/reminder-views";
import { t } from "../../i18n/t";
import { actions, useVesta, type VestaState } from "../../store/store";

const PAUSE_MS = 500;

function resultCount(s: VestaState): number {
  const view = searchView({
    active: true,
    tree: activeTree(Object.values(s.tasks)),
    reminders: activeReminders(Object.values(s.reminders)),
    allTasks: Object.values(s.tasks),
    allReminders: Object.values(s.reminders),
    matches: s.search.session.matches,
    pinned: s.search.session.pinned,
    includeArchiveTrash: s.search.includeArchiveTrash,
  });
  const tasks = view.tree.reduce((n, node) => n + (s.search.session.matches.has(node.task.id) ? 1 : 0) + node.subtasks.length, 0);
  return tasks + view.reminders.length + view.elsewhere.length;
}

export function startSearchAnnouncements(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useVesta.subscribe((s, prev) => {
    if (s.search === prev.search) return;
    if (s.search.active && s.search.session.slow && !prev.search.session.slow) actions.announce(t("searchPreparing"));
    if (!s.search.active || s.search.session.slow || !s.search.session.applied) return;
    if (s.search.session.matches === prev.search.session.matches && s.search.text === prev.search.text) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const state = useVesta.getState();
      if (!state.search.active || state.search.session.slow || !state.search.session.applied) return;
      const n = resultCount(state);
      actions.announce(n === 0 ? t("resultsNone") : t("results", { count: n }));
    }, PAUSE_MS);
  });
  return () => {
    unsubscribe();
    if (timer !== null) clearTimeout(timer);
  };
}
