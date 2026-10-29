/** The shortcut actions, their defaults, kinds and views (007 FR-020 to FR-022, FR-031a, FR-031b; 013 FR-048). */
import type { Combo } from "./combo";
import { FORMAT_SHORTCUT_IDS, type FormatCommandId } from "../menu/commands";

export type ActionId =
  | "newTask"
  | "newSub"
  | "newRem"
  | "search"
  | "up"
  | "down"
  | "open"
  | "edit"
  | "done"
  | "del"
  | "moveUp"
  | "moveDown"
  | "promote"
  | "demote"
  | "collapse"
  | "expand"
  | "close"
  | "settings"
  | "undo"
  | "restore"
  | "minimize"
  | "indentItem"
  | "outdentItem"
  // 013 FR-048 (PRD Q186): every menu command is a shortcut action; these ids are the menu commands' own.
  | "about"
  | "checkUpdates"
  | "export"
  | "import"
  | "searchEverything"
  | "matchCase"
  | "exactPhrase"
  | "reschedule"
  | "postponeFor1"
  | "postponeFor2"
  | "postponeFor3"
  | "postponeFor4"
  | "alertPeriod"
  | "deleteForever"
  | "copyLink"
  | "view:tasks"
  | "view:archive"
  | "view:trash"
  | "showReminders"
  | "showLogs"
  | "help"
  | "releaseNotes"
  | FormatCommandId;

/**
 * `selection`: acts on the selected card, only when no text is edited (FR-021). `global`: from anywhere (FR-022).
 * `editor` (012 FR-009): acts only inside the details editor. 013 FR-048: `command`, a menu command, from anywhere
 * where its menu item is enabled; `format`, a Format command, in any editor whose floating menu offers it.
 */
export type ActionKind = "selection" | "global" | "close" | "undo" | "editor" | "command" | "format";

/** Where a selection or editor action can act. Global, close and undo actions count in every view. */
/** 018 (research §4): the Archive and the Trash are separate views, so Delete can mean Move to Trash in one and Delete
 * Permanently in the other. */
export type ActionView = "main" | "archive" | "trash" | "editor";

export interface ShortcutAction {
  id: ActionId;
  kind: ActionKind;
  views: readonly ActionView[];
  /** Platform defaults; empty for Minimize window outside macOS (PRD Q117). */
  defaults: (isMac: boolean) => readonly Combo[];
  /** Locale key of the action's label in Settings. */
  labelKey: string;
}

const MAIN: readonly ActionView[] = ["main"];
const BOTH: readonly ActionView[] = ["main", "archive", "trash"];
const ARCHIVE_TRASH: readonly ActionView[] = ["archive", "trash"];
const EDITOR: readonly ActionView[] = ["editor"];
const EVERYWHERE: readonly ActionView[] = ["main", "archive", "trash", "editor"];

const fixed =
  (...combos: Combo[]) =>
  (): readonly Combo[] =>
    combos;

const none = (): readonly Combo[] => [];
/** The menu label of each Format shortcut action (contracts/menu.md). */
const FORMAT_LABEL: Readonly<Partial<Record<FormatCommandId, string>>> = {
  "fmt:underline": "menuUnderline",
  "fmt:color": "menuTextColor",
  "fmt:bg": "menuHighlightColor",
  "fmt:size-up": "menuSizeUp",
  "fmt:size-down": "menuSizeDown",
  "fmt:row-above": "menuRowAbove",
  "fmt:row-below": "menuRowBelow",
  "fmt:col-left": "menuColLeft",
  "fmt:col-right": "menuColRight",
  "fmt:row-delete": "menuRowDelete",
  "fmt:col-delete": "menuColDelete",
  "fmt:table-delete": "menuTableDelete",
  "fmt:link": "menuLink",
  "fmt:insert": "menuInsertFile",
};
const command = (id: ActionId, labelKey: string, defaults: (isMac: boolean) => readonly Combo[] = none): ShortcutAction => ({
  id,
  kind: "command",
  views: BOTH,
  defaults,
  labelKey,
});

/**
 * FR-020 order, then the menu commands of 013 FR-048. The labels are the menu bar's (FR-012, PRD Q186), the
 * Settings table drops their ellipsis; the list actions keep their own (the table's Lists group).
 */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = Object.freeze([
  { id: "newTask", kind: "global", views: BOTH, defaults: fixed("Mod+N"), labelKey: "menuNewTask" },
  { id: "newSub", kind: "global", views: BOTH, defaults: fixed("Mod+Shift+N"), labelKey: "menuNewSubtask" },
  { id: "newRem", kind: "global", views: BOTH, defaults: fixed("Mod+Shift+R"), labelKey: "menuNewReminder" },
  { id: "search", kind: "global", views: BOTH, defaults: fixed("Mod+F"), labelKey: "menuFind" },
  { id: "up", kind: "selection", views: BOTH, defaults: fixed("ArrowUp"), labelKey: "sc_up" },
  { id: "down", kind: "selection", views: BOTH, defaults: fixed("ArrowDown"), labelKey: "sc_down" },
  // 011 FR-022b (PRD Q144): in the Archive and the Trash, Enter opens a task's details read-only.
  // 013 PRD Q188: View › Show Details is this action.
  { id: "open", kind: "selection", views: BOTH, defaults: fixed("Enter"), labelKey: "menuShowDetails" },
  { id: "edit", kind: "selection", views: MAIN, defaults: fixed("F2"), labelKey: "sc_edit" },
  { id: "done", kind: "selection", views: MAIN, defaults: fixed("Mod+Enter"), labelKey: "menuMarkDone" },
  // 013 PRD Q187: Move to Trash in the main view; in the Trash the same keys are Delete Permanently.
  { id: "del", kind: "selection", views: ["main", "archive"], defaults: fixed("Delete", "Backspace"), labelKey: "menuMoveToTrash" },
  { id: "moveUp", kind: "selection", views: MAIN, defaults: fixed("Alt+ArrowUp"), labelKey: "sc_moveUp" },
  { id: "moveDown", kind: "selection", views: MAIN, defaults: fixed("Alt+ArrowDown"), labelKey: "sc_moveDown" },
  { id: "promote", kind: "selection", views: MAIN, defaults: fixed("Alt+ArrowLeft"), labelKey: "sc_promote" },
  { id: "demote", kind: "selection", views: MAIN, defaults: fixed("Alt+ArrowRight"), labelKey: "sc_demote" },
  { id: "collapse", kind: "selection", views: MAIN, defaults: fixed("ArrowLeft"), labelKey: "sc_collapse" },
  { id: "expand", kind: "selection", views: MAIN, defaults: fixed("ArrowRight"), labelKey: "sc_expand" },
  { id: "close", kind: "close", views: BOTH, defaults: fixed("Escape"), labelKey: "sc_close" },
  { id: "settings", kind: "global", views: BOTH, defaults: fixed("Mod+,"), labelKey: "menuSettings" },
  { id: "undo", kind: "undo", views: BOTH, defaults: fixed("Mod+Z"), labelKey: "menuUndo" },
  { id: "restore", kind: "selection", views: ARCHIVE_TRASH, defaults: fixed("Shift+Enter"), labelKey: "menuRestore" },
  {
    id: "minimize",
    kind: "global",
    views: BOTH,
    defaults: (isMac: boolean): readonly Combo[] => (isMac ? ["Mod+M"] : []),
    labelKey: "menuMinimize",
  },
  // 012 FR-009 (PRD Q161): list items in the details; Tab and Shift+Tab move the focus instead.
  { id: "indentItem", kind: "editor", views: EDITOR, defaults: fixed("Mod+]"), labelKey: "menuIndent" },
  { id: "outdentItem", kind: "editor", views: EDITOR, defaults: fixed("Mod+["), labelKey: "menuOutdent" },
  // 013 FR-048 (PRD Q186): the menu commands; only the views and Delete Permanently have defaults.
  // 016 FR-017 (PRD Q234): Edit › Copy Link, in an editor too; its menu item says when it may act.
  { id: "copyLink", kind: "command", views: EVERYWHERE, defaults: fixed("Mod+Shift+C"), labelKey: "menuCopyLink" },
  command("about", "menuAbout"),
  command("checkUpdates", "menuCheckUpdates"),
  command("export", "menuExport"),
  command("import", "menuImport"),
  command("searchEverything", "menuSearchEverything"),
  command("matchCase", "menuMatchCase"),
  command("exactPhrase", "menuExactPhrase"),
  { id: "reschedule", kind: "selection", views: MAIN, defaults: none, labelKey: "menuReschedule" },
  // 015 FR-010 (013 FR-048): Edit › Postpone For's items are remappable too, with no default.
  { id: "postponeFor1", kind: "selection", views: MAIN, defaults: none, labelKey: "scPostpone1" },
  { id: "postponeFor2", kind: "selection", views: MAIN, defaults: none, labelKey: "scPostpone2" },
  { id: "postponeFor3", kind: "selection", views: MAIN, defaults: none, labelKey: "scPostpone3" },
  { id: "postponeFor4", kind: "selection", views: MAIN, defaults: none, labelKey: "scPostpone4" },
  { id: "alertPeriod", kind: "selection", views: MAIN, defaults: none, labelKey: "menuAlertPeriod" },
  // PRD Q187: the distinctive key first, since the menu shows the first (analysis M4).
  {
    id: "deleteForever",
    kind: "selection",
    views: ["trash"],
    defaults: (isMac: boolean): readonly Combo[] => (isMac ? ["Mod+Alt+Backspace", "Delete", "Backspace"] : ["Shift+Delete", "Delete", "Backspace"]),
    labelKey: "menuDeleteForever",
  },
  command("view:tasks", "menuTasks", fixed("Mod+1")),
  command("view:archive", "menuArchive", fixed("Mod+2")),
  command("view:trash", "menuTrash", fixed("Mod+3")),
  command("showReminders", "menuShowReminders"),
  command("showLogs", "menuShowLogs"),
  command("help", "menuVestaHelp"),
  command("releaseNotes", "menuReleaseNotes"),
  ...FORMAT_SHORTCUT_IDS.map((id): ShortcutAction => ({ id, kind: "format", views: EDITOR, defaults: none, labelKey: FORMAT_LABEL[id] ?? id })),
] satisfies ShortcutAction[]);

const BY_ID = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a]));

export function isActionId(value: string): value is ActionId {
  return BY_ID.has(value as ActionId);
}

export function actionById(id: ActionId): ShortcutAction {
  const action = BY_ID.get(id);
  if (action === undefined) throw new Error(`unknown action ${id}`);
  return action;
}

/**
 * Global, close, undo and command actions act in every view, the editors included; selection, editor and format
 * actions only in theirs.
 */
export function viewsOf(action: ShortcutAction): readonly ActionView[] {
  return action.kind === "selection" || action.kind === "editor" || action.kind === "format" ? action.views : EVERYWHERE;
}

export function viewsOverlap(a: ShortcutAction, b: ShortcutAction): boolean {
  const vb = viewsOf(b);
  return viewsOf(a).some((v) => vb.includes(v));
}
