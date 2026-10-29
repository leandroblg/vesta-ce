/**
 * The menu bar's commands and menus, once (013 FR-001 to FR-009, research §1, contracts/menu.md). Pure: the
 * main process builds the native menu from it, the renderer routes the same ids, and the shortcut actions name
 * the combination each item shows.
 */
import type { ActionId } from "../shortcuts/actions";
import type { Combo } from "../shortcuts/combo";

/** The floating menu's option ids (floating-menu.ts `OPTIONS`) and the table actions (table-handles.ts). */
export const FORMAT_OPTION_IDS = [
  "strong",
  "emphasis",
  "underline",
  "strike_through",
  "inlineCode",
  "mark",
  "color",
  "bg",
  "size-up",
  "size-down",
  "bullet",
  "ordered",
  "check",
  "indent",
  "outdent",
  "quote",
  "codeblock",
  "hr",
  "table",
  "row-above",
  "row-below",
  "col-left",
  "col-right",
  "row-delete",
  "col-delete",
  "table-delete",
  "link",
  "insert",
] as const;
export type FormatOptionId = (typeof FORMAT_OPTION_IDS)[number];

export const HEADING_LEVELS = [0, 1, 2, 3, 4, 5, 6] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

export type FormatCommandId = `fmt:${FormatOptionId}` | `fmt:heading-${HeadingLevel}`;

export type MenuCommandId =
  | "about"
  | "settings"
  | "checkUpdates"
  | "newTask"
  | "newSub"
  | "newRem"
  | "export"
  | "import"
  | "undo"
  | "redo"
  | "copyLink"
  | "find"
  | "searchEverything"
  | "matchCase"
  | "exactPhrase"
  | "done"
  | "reschedule"
  | "postponeFor1"
  | "postponeFor2"
  | "postponeFor3"
  | "postponeFor4"
  | "alertPeriod"
  | "trash"
  | "restore"
  | "deleteForever"
  | FormatCommandId
  | "view:tasks"
  | "view:archive"
  | "view:trash"
  | "showReminders"
  | "showDetails"
  | "minimize"
  | "showLogs"
  | "help"
  | "releaseNotes";

/**
 * 013 FR-048 (PRD Q186): the Format commands the editor also makes from typed markdown (an input rule each), which
 * keep the editor's own keys and are not shortcut actions. `tests/unit/editor/format-actions.test.ts` checks every
 * one against the details editor's input rules.
 */
export const INPUT_RULE_FORMATS: Readonly<Partial<Record<FormatCommandId, string>>> = Object.freeze({
  "fmt:strong": "strongInputRule",
  "fmt:emphasis": "emphasisStarInputRule",
  "fmt:inlineCode": "inlineCodeInputRule",
  "fmt:strike_through": "strikethroughInputRule",
  "fmt:mark": "markInputRule",
  "fmt:heading-0": "wrapInHeadingInputRule",
  "fmt:heading-1": "wrapInHeadingInputRule",
  "fmt:heading-2": "wrapInHeadingInputRule",
  "fmt:heading-3": "wrapInHeadingInputRule",
  "fmt:heading-4": "wrapInHeadingInputRule",
  "fmt:heading-5": "wrapInHeadingInputRule",
  "fmt:heading-6": "wrapInHeadingInputRule",
  "fmt:bullet": "wrapInBulletListInputRule",
  "fmt:ordered": "wrapInOrderedListInputRule",
  "fmt:check": "checklistInputRule",
  "fmt:quote": "wrapInBlockquoteInputRule",
  "fmt:codeblock": "createCodeBlockInputRule",
  "fmt:hr": "insertHrInputRule",
  "fmt:table": "insertTableInputRule",
});

/** The Format commands that are shortcut actions with no default (FR-048); Indent and Outdent have their own. */
export const FORMAT_SHORTCUT_IDS: readonly FormatCommandId[] = FORMAT_OPTION_IDS.map((o) => `fmt:${o}` as FormatCommandId).filter(
  (id) => !(id in INPUT_RULE_FORMATS) && id !== "fmt:indent" && id !== "fmt:outdent",
);

export interface MenuCommand {
  id: MenuCommandId;
  /** Locale key of the label (the ellipsis is part of the text, FR-011). */
  labelKey: string;
  /** The shortcut action whose current combination the item shows (FR-013). */
  action?: ActionId;
  /** A fixed combination shown when the key belongs to the editor (Redo, the Format keys of research §5). */
  accel?: Combo;
  ellipsis: boolean;
  type: "normal" | "checkbox" | "radio";
  /** On macOS with the window hidden, main shows the window first (FR-020, research §6). */
  needsWindow: boolean;
  /** 015 FR-010: a Postpone For item, labelled with this quick duration (its index in menu order) instead of `labelKey`. */
  duration?: 0 | 1 | 2 | 3;
}

/** 013 FR-048: the menu commands whose shortcut action has the command's own id (all but the older ones). */
const SELF_ACTIONS: ReadonlySet<string> = new Set<string>([
  "about",
  "checkUpdates",
  "export",
  "import",
  "searchEverything",
  "matchCase",
  "exactPhrase",
  "reschedule",
  "copyLink",
  "postponeFor1",
  "postponeFor2",
  "postponeFor3",
  "postponeFor4",
  "alertPeriod",
  "deleteForever",
  "view:tasks",
  "view:archive",
  "view:trash",
  "showReminders",
  "showLogs",
  "help",
  "releaseNotes",
  ...FORMAT_SHORTCUT_IDS,
]);

const cmd = (id: MenuCommandId, labelKey: string, extra: Partial<Omit<MenuCommand, "id" | "labelKey">> = {}): MenuCommand => ({
  id,
  labelKey,
  ellipsis: false,
  type: "normal",
  needsWindow: false,
  ...(SELF_ACTIONS.has(id) ? { action: id as ActionId } : {}),
  ...extra,
});

const fmt = (id: FormatOptionId, labelKey: string, extra: Partial<Omit<MenuCommand, "id" | "labelKey">> = {}): MenuCommand =>
  cmd(`fmt:${id}`, labelKey, extra);

const CHECK = { type: "checkbox" } as const;
const RADIO = { type: "radio" } as const;
const DOTS = { ellipsis: true } as const;
const WIN = { needsWindow: true } as const;

/** Every custom item; role items (Services, Hide, Quit, Cut, …) are not commands. */
export const MENU_COMMANDS: readonly MenuCommand[] = Object.freeze([
  cmd("about", "menuAbout", WIN),
  cmd("settings", "menuSettings", { ...DOTS, ...WIN, action: "settings" }),
  cmd("checkUpdates", "menuCheckUpdates", { ...DOTS, ...WIN }),
  cmd("newTask", "menuNewTask", { ...WIN, action: "newTask" }),
  cmd("newSub", "menuNewSubtask", { action: "newSub" }),
  cmd("newRem", "menuNewReminder", { ...WIN, action: "newRem" }),
  cmd("export", "menuExport", { ...DOTS, ...WIN }),
  cmd("import", "menuImport", { ...DOTS, ...WIN }),
  cmd("undo", "menuUndo", { action: "undo" }),
  cmd("redo", "menuRedo", { accel: "Mod+Shift+Z" }),
  // 016 FR-017 (PRD Q234): the address of the one link at the editor's selection.
  cmd("copyLink", "menuCopyLink"),
  cmd("find", "menuFind", { ...WIN, action: "search" }),
  cmd("searchEverything", "menuSearchEverything", { ...CHECK, ...WIN }),
  cmd("matchCase", "menuMatchCase", { ...CHECK, ...WIN }),
  cmd("exactPhrase", "menuExactPhrase", { ...CHECK, ...WIN }),
  cmd("done", "menuMarkDone", { action: "done" }),
  cmd("reschedule", "menuReschedule"),
  // 015 FR-010, FR-013 (PRD Q207, Q221): the quick durations, labelled with their current values.
  cmd("postponeFor1", "menuPostponeFor", { duration: 0 }),
  cmd("postponeFor2", "menuPostponeFor", { duration: 1 }),
  cmd("postponeFor3", "menuPostponeFor", { duration: 2 }),
  cmd("postponeFor4", "menuPostponeFor", { duration: 3 }),
  cmd("alertPeriod", "menuAlertPeriod", DOTS),
  cmd("trash", "menuMoveToTrash", { action: "del" }),
  cmd("restore", "menuRestore", { action: "restore" }),
  cmd("deleteForever", "menuDeleteForever", DOTS),
  fmt("strong", "menuBold", { ...CHECK, accel: "Mod+B" }),
  fmt("emphasis", "menuItalic", { ...CHECK, accel: "Mod+I" }),
  fmt("underline", "menuUnderline", CHECK),
  fmt("strike_through", "menuStrikethrough", { ...CHECK, accel: "Mod+Alt+X" }),
  fmt("inlineCode", "menuCode", { ...CHECK, accel: "Mod+E" }),
  fmt("mark", "menuHighlight", CHECK),
  fmt("color", "menuTextColor", DOTS),
  fmt("bg", "menuHighlightColor", DOTS),
  fmt("size-up", "menuSizeUp"),
  fmt("size-down", "menuSizeDown"),
  ...HEADING_LEVELS.map((n) =>
    cmd(`fmt:heading-${n}`, n === 0 ? "menuHeadingNone" : "menuHeadingN", { ...RADIO, accel: `Mod+Alt+${String(n)}` }),
  ),
  fmt("bullet", "menuBulletedList", { ...CHECK, accel: "Mod+Alt+8" }),
  fmt("ordered", "menuNumberedList", { ...CHECK, accel: "Mod+Alt+7" }),
  fmt("check", "menuChecklist", CHECK),
  fmt("indent", "menuIndent", { action: "indentItem" }),
  fmt("outdent", "menuOutdent", { action: "outdentItem" }),
  fmt("quote", "menuQuote", { ...CHECK, accel: "Mod+Shift+B" }),
  fmt("codeblock", "menuCodeBlock", { ...CHECK, accel: "Mod+Alt+C" }),
  fmt("hr", "menuDivider"),
  fmt("table", "menuInsertTable", DOTS),
  fmt("row-above", "menuRowAbove"),
  fmt("row-below", "menuRowBelow"),
  fmt("col-left", "menuColLeft"),
  fmt("col-right", "menuColRight"),
  fmt("row-delete", "menuRowDelete"),
  fmt("col-delete", "menuColDelete"),
  fmt("table-delete", "menuTableDelete"),
  // FR-016: checked while the selection is linked, as the floating Link button is pressed.
  fmt("link", "menuLink", { ...DOTS, ...CHECK }),
  fmt("insert", "menuInsertFile", DOTS),
  cmd("view:tasks", "menuTasks", { ...RADIO, ...WIN }),
  cmd("view:archive", "menuArchive", { ...RADIO, ...WIN }),
  cmd("view:trash", "menuTrash", { ...RADIO, ...WIN }),
  cmd("showReminders", "menuShowReminders", { ...CHECK, ...WIN }),
  cmd("showDetails", "menuShowDetails", { ...CHECK, action: "open" }),
  cmd("minimize", "menuMinimize", { action: "minimize" }),
  cmd("showLogs", "menuShowLogs", WIN),
  cmd("help", "menuVestaHelp"),
  cmd("releaseNotes", "menuReleaseNotes"),
] satisfies MenuCommand[]);

const BY_ID = new Map<string, MenuCommand>(MENU_COMMANDS.map((c) => [c.id, c]));

export function isMenuCommandId(value: unknown): value is MenuCommandId {
  return typeof value === "string" && BY_ID.has(value);
}

export function menuCommand(id: MenuCommandId): MenuCommand {
  const c = BY_ID.get(id);
  if (c === undefined) throw new Error(`unknown menu command ${id}`);
  return c;
}

/** The system items the template draws as Electron roles (their labels are translated, FR-011). */
export type RoleName =
  | "services"
  | "hide"
  | "hideOthers"
  | "unhide"
  | "quit"
  | "cut"
  | "copy"
  | "paste"
  | "selectAll"
  | "zoom"
  | "front"
  | "close";

export type MenuEntry =
  | { kind: "command"; id: MenuCommandId }
  | { kind: "role"; role: RoleName; labelKey: string }
  | { kind: "separator" }
  | { kind: "submenu"; labelKey: string; entries: readonly MenuEntry[] };

export interface MenuSpec {
  /** The menu's id ("app", "file", …) and its title's locale key. */
  id: "app" | "file" | "edit" | "format" | "view" | "window" | "help";
  labelKey: string;
  entries: readonly MenuEntry[];
}

const c = (id: MenuCommandId): MenuEntry => ({ kind: "command", id });
const role = (r: RoleName, labelKey: string): MenuEntry => ({ kind: "role", role: r, labelKey });
const SEP: MenuEntry = { kind: "separator" };

/** The menus in order for one platform (contracts/menu.md; the Develop menu is added by main). */
export function MENUS(isMac: boolean): readonly MenuSpec[] {
  const menus: MenuSpec[] = [];
  if (isMac)
    menus.push({
      id: "app",
      labelKey: "appName",
      entries: [
        c("about"),
        SEP,
        c("settings"),
        c("checkUpdates"),
        SEP,
        role("services", "menuServices"),
        SEP,
        role("hide", "menuHide"),
        role("hideOthers", "menuHideOthers"),
        role("unhide", "menuShowAll"),
        SEP,
        role("quit", "menuQuit"),
      ],
    });
  menus.push({
    id: "file",
    labelKey: "menuFile",
    entries: [
      c("newTask"),
      c("newSub"),
      c("newRem"),
      SEP,
      c("export"),
      c("import"),
      SEP,
      ...(isMac
        ? [role("close", "menuClose")]
        : [c("settings"), c("checkUpdates"), SEP, role("quit", "menuQuitOther")]),
    ],
  });
  menus.push({
    id: "edit",
    labelKey: "menuEdit",
    entries: [
      c("undo"),
      c("redo"),
      SEP,
      role("cut", "menuCut"),
      role("copy", "menuCopy"),
      c("copyLink"),
      role("paste", "menuPaste"),
      role("selectAll", "menuSelectAll"),
      SEP,
      c("find"),
      c("searchEverything"),
      c("matchCase"),
      c("exactPhrase"),
      SEP,
      c("done"),
      c("reschedule"),
      { kind: "submenu", labelKey: "menuPostponeFor", entries: [c("postponeFor1"), c("postponeFor2"), c("postponeFor3"), c("postponeFor4")] },
      c("alertPeriod"),
      c("trash"),
      SEP,
      c("restore"),
      c("deleteForever"),
    ],
  });
  menus.push({
    id: "format",
    labelKey: "menuFormat",
    entries: [
      c("fmt:strong"),
      c("fmt:emphasis"),
      c("fmt:underline"),
      c("fmt:strike_through"),
      c("fmt:inlineCode"),
      SEP,
      c("fmt:mark"),
      c("fmt:color"),
      c("fmt:bg"),
      SEP,
      c("fmt:size-up"),
      c("fmt:size-down"),
      SEP,
      { kind: "submenu", labelKey: "menuHeading", entries: HEADING_LEVELS.map((n) => c(`fmt:heading-${n}`)) },
      SEP,
      c("fmt:bullet"),
      c("fmt:ordered"),
      c("fmt:check"),
      c("fmt:indent"),
      c("fmt:outdent"),
      c("fmt:quote"),
      c("fmt:codeblock"),
      c("fmt:hr"),
      SEP,
      {
        kind: "submenu",
        labelKey: "menuTable",
        entries: [
          c("fmt:table"),
          SEP,
          c("fmt:row-above"),
          c("fmt:row-below"),
          c("fmt:col-left"),
          c("fmt:col-right"),
          SEP,
          c("fmt:row-delete"),
          c("fmt:col-delete"),
          SEP,
          c("fmt:table-delete"),
        ],
      },
      SEP,
      c("fmt:link"),
      c("fmt:insert"),
    ],
  });
  menus.push({
    id: "view",
    labelKey: "menuView",
    entries: [c("view:tasks"), c("view:archive"), c("view:trash"), SEP, c("showReminders"), c("showDetails")],
  });
  menus.push({
    id: "window",
    labelKey: "menuWindow",
    entries: isMac
      ? [c("minimize"), role("zoom", "menuZoom"), SEP, c("showLogs"), SEP, role("front", "menuFront")]
      : [c("minimize"), SEP, c("showLogs"), SEP, role("close", "menuCloseOther")],
  });
  menus.push({
    id: "help",
    labelKey: "menuHelp",
    entries: isMac ? [c("help"), c("releaseNotes")] : [c("help"), c("releaseNotes"), SEP, c("about")],
  });
  return menus;
}

/** Every command a platform's menus hold, in order (submenus flattened). */
export function commandsIn(menus: readonly MenuSpec[]): MenuCommandId[] {
  const out: MenuCommandId[] = [];
  const walk = (entries: readonly MenuEntry[]) => {
    for (const e of entries) {
      if (e.kind === "command") out.push(e.id);
      else if (e.kind === "submenu") walk(e.entries);
    }
  };
  for (const m of menus) walk(m.entries);
  return out;
}
