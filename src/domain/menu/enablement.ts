/**
 * Which menu items are enabled and checked (013 FR-015, FR-016, FR-019 to FR-021, data-model "MenuItemStates").
 * The rows apply first; the two overrides under the table apply after them (analysis L1).
 */
import { MENU_COMMANDS, type MenuCommandId } from "./commands";
import type { CommandState, SnapshotId, TableActionId } from "./state";
import { TABLE_ACTION_IDS } from "./state";

export interface ItemState {
  enabled: boolean;
  checked?: boolean;
}

/** Items that change an item or a setting: disabled while Settings or About is open, or an import runs (FR-019). */
const CHANGING: ReadonlySet<MenuCommandId> = new Set<MenuCommandId>([
  "newTask",
  "newSub",
  "newRem",
  // FR-019: Export… changes no item or setting, so it stays enabled while Settings is open (data model).
  "import",
  "undo",
  "done",
  "reschedule",
  "alertPeriod",
  "trash",
  "restore",
  "deleteForever",
  "showReminders",
]);

function isTableAction(id: string): id is TableActionId {
  return (TABLE_ACTION_IDS as readonly string[]).includes(id);
}

function row(id: MenuCommandId, s: CommandState, shown: boolean): ItemState {
  const t = s.target;
  const blocking = s.modal === "settings" || s.modal === "about";
  const selectable = shown && s.editing === "none";
  const onMainSelection = selectable && (s.modal === "none" || s.modal === "transient") && s.view === "tasks" && t !== null;
  if (id.startsWith("fmt:")) {
    const f = s.format;
    const opt = id.slice(4);
    if (f === null) return { enabled: false, checked: false };
    const offered = (x: SnapshotId) => shown && f.offered.includes(x) && !f.disabled.includes(x);
    if (opt.startsWith("heading-")) return { enabled: offered("heading"), checked: f.heading === Number(opt.slice(8)) };
    if (isTableAction(opt)) return { enabled: shown && f.inTable && f.tableActions.includes(opt) };
    if (opt === "table") return { enabled: offered("table") && !f.inTable };
    const sid = opt as SnapshotId;
    return { enabled: offered(sid), checked: f.pressed.includes(sid) };
  }
  switch (id) {
    case "about":
    case "help":
    case "releaseNotes":
      return { enabled: true };
    case "minimize":
      return { enabled: shown };
    case "settings":
    case "checkUpdates":
    case "showLogs":
      return { enabled: s.modal !== "about" };
    case "newTask":
      return { enabled: !blocking && !s.busy };
    case "newRem":
      return { enabled: !blocking && !s.busy && !s.remindersFull };
    case "newSub":
      // FR-015: only where the view offers it; its handler refuses in the Archive and the Trash.
      return { enabled: selectable && s.view === "tasks" && t !== null && t.kind === "task" && t.topLevel };
    case "export":
    case "import":
      return { enabled: !s.busy && s.modal !== "about" };
    case "undo":
      return { enabled: s.undoOffered || s.editing !== "none" };
    case "redo":
      // 016 FR-003a: the editor's redo, or the redo of an undone reschedule while its notice shows.
      return { enabled: s.redoOffered || s.editing !== "none" };
    case "copyLink":
      // 016 FR-017: only while the focused editor's selection or cursor lies inside one safe link.
      return { enabled: s.linkAtCursor && s.modal !== "about" };
    case "find":
      return { enabled: !blocking };
    case "searchEverything":
      return { enabled: !blocking, checked: s.search.everything };
    case "matchCase":
      return { enabled: !blocking, checked: s.search.matchCase };
    case "exactPhrase":
      return { enabled: !blocking, checked: s.search.exactPhrase };
    case "done":
      return { enabled: onMainSelection };
    // 018 FR-009 (PRD Q272): Move to Trash acts on a selected Archive entry too.
    case "trash":
      return { enabled: onMainSelection || (selectable && (s.modal === "none" || s.modal === "transient") && s.view === "archive" && t !== null) };
    // 015 FR-002, FR-010 (PRD Q203, Q207): every active task and subtask, stale or not; Postpone For likewise.
    case "reschedule":
    case "postponeFor1":
    case "postponeFor2":
    case "postponeFor3":
    case "postponeFor4":
      return { enabled: onMainSelection && t.kind !== "reminder" };
    case "alertPeriod":
      return { enabled: onMainSelection && t.kind !== "reminder" };
    case "restore":
      return { enabled: selectable && s.view !== "tasks" && t !== null };
    case "deleteForever":
      return { enabled: selectable && s.view === "trash" && t !== null };
    case "view:tasks":
    case "view:archive":
    case "view:trash":
      return { enabled: !blocking, checked: s.view === id.slice(5) };
    case "showReminders":
      return { enabled: !s.search.active && s.view === "tasks", checked: s.remindersExpanded };
    case "showDetails":
      // US1-9: a task or subtask; a reminder or nothing disables it, also with a panel open (the target is the
      // focused card first, so a focused reminder is the target even then).
      return { enabled: selectable && t !== null && t.kind !== "reminder", checked: s.panelOpen };
  }
  return { enabled: false };
}

export function enablement(s: CommandState, windowShown: boolean): Record<MenuCommandId, ItemState> {
  const out = {} as Record<MenuCommandId, ItemState>;
  const blocking = s.modal === "settings" || s.modal === "about";
  for (const { id } of MENU_COMMANDS) {
    const state = row(id, s, windowShown);
    if ((blocking || s.busy) && (CHANGING.has(id) || id.startsWith("fmt:"))) state.enabled = false;
    // PRD Q183: About is modal; only About Vesta and Minimize act while it is open.
    if (s.modal === "about" && id !== "about" && id !== "minimize") state.enabled = false;
    out[id] = state;
  }
  return out;
}
