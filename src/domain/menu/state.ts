/**
 * What the menu bar needs to know to enable and check its items (013 data-model "CommandState", research §3).
 * The renderer builds the input from its store and the focus; `commandState` is pure and unit-tested.
 */
import { FORMAT_OPTION_IDS, HEADING_LEVELS, type FormatOptionId, type HeadingLevel } from "./commands";

export const TABLE_ACTION_IDS = ["row-above", "row-below", "col-left", "col-right", "row-delete", "col-delete", "table-delete"] as const;
export type TableActionId = (typeof TABLE_ACTION_IDS)[number];

/** An id the floating menu reports: its options, plus the Heading button. */
export type SnapshotId = FormatOptionId | "heading";
export const SNAPSHOT_IDS: readonly SnapshotId[] = [...FORMAT_OPTION_IDS, "heading"];

/** The active floating menu's offer (FR-016): what it shows, what is pressed, what is disabled. */
export interface FormatSnapshot {
  offered: SnapshotId[];
  pressed: SnapshotId[];
  disabled: SnapshotId[];
  heading: HeadingLevel;
  inTable: boolean;
  tableActions: TableActionId[];
}

export type ViewName = "tasks" | "archive" | "trash";
export type TargetKind = "task" | "subtask" | "reminder";
export interface Target {
  kind: TargetKind;
  topLevel: boolean;
  stale: boolean;
}
export type Editing = "none" | "text" | "title" | "reminder" | "details";
export type Modal = "none" | "settings" | "about" | "transient";

export interface CommandState {
  view: ViewName;
  target: Target | null;
  editing: Editing;
  format: FormatSnapshot | null;
  remindersExpanded: boolean;
  panelOpen: boolean;
  search: { active: boolean; everything: boolean; matchCase: boolean; exactPhrase: boolean };
  modal: Modal;
  busy: boolean;
  remindersFull: boolean;
  undoOffered: boolean;
  /** 016 FR-003a: a Redo notification is visible. */
  redoOffered: boolean;
  /** 016 FR-017: the focused editor's selection or cursor lies inside exactly one safe link. */
  linkAtCursor: boolean;
}

export interface CommandStateInput {
  view: ViewName;
  /** The card that holds the keyboard focus, if any. */
  focused: Target | null;
  /** The item open in the details panel, if any. */
  panelItem: Target | null;
  /** The scope of the focused editor, if one has the focus. */
  editorScope: "title" | "reminder" | "details" | null;
  /** Another text field (search box, Settings field, alert override field) has the focus. */
  textFocus: boolean;
  format: FormatSnapshot | null;
  remindersCollapsed: boolean;
  search: CommandState["search"];
  settingsOpen: boolean;
  aboutOpen: boolean;
  /** A context menu, alert override modal, color picker or size grid is open. */
  transientOpen: boolean;
  dataOp: "idle" | "exporting" | "importing" | "undoing";
  remindersFull: boolean;
  undoOffered: boolean;
  /** 016 FR-003a: a Redo notification is visible. */
  redoOffered: boolean;
  /** 016 FR-017: the focused editor's selection or cursor lies inside exactly one safe link. */
  linkAtCursor: boolean;
}

/** FR-015 (PRD Q182): with no keyboard selection, the panel's item is the target. */
export function commandState(input: CommandStateInput): CommandState {
  const editing: Editing = input.editorScope ?? (input.textFocus ? "text" : "none");
  const modal: Modal = input.settingsOpen ? "settings" : input.aboutOpen ? "about" : input.transientOpen ? "transient" : "none";
  return {
    view: input.view,
    target: input.focused ?? input.panelItem,
    editing,
    format: input.editorScope === null ? null : input.format,
    remindersExpanded: !input.remindersCollapsed,
    panelOpen: input.panelItem !== null,
    search: { ...input.search },
    modal,
    busy: input.dataOp !== "idle",
    remindersFull: input.remindersFull,
    undoOffered: input.undoOffered,
    redoOffered: input.redoOffered,
    linkAtCursor: input.linkAtCursor,
  };
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sameFormat(a: FormatSnapshot | null, b: FormatSnapshot | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.heading === b.heading &&
    a.inTable === b.inTable &&
    sameList(a.offered, b.offered) &&
    sameList(a.pressed, b.pressed) &&
    sameList(a.disabled, b.disabled) &&
    sameList(a.tableActions, b.tableActions)
  );
}

/** Structural equality, so an unchanged state is never sent twice (research §3). */
export function sameState(a: CommandState | null, b: CommandState | null): boolean {
  if (a === null || b === null) return a === b;
  const ta = a.target;
  const tb = b.target;
  const sameTarget = ta === null || tb === null ? ta === tb : ta.kind === tb.kind && ta.topLevel === tb.topLevel && ta.stale === tb.stale;
  return (
    a.view === b.view &&
    sameTarget &&
    a.editing === b.editing &&
    sameFormat(a.format, b.format) &&
    a.remindersExpanded === b.remindersExpanded &&
    a.panelOpen === b.panelOpen &&
    a.search.active === b.search.active &&
    a.search.everything === b.search.everything &&
    a.search.matchCase === b.search.matchCase &&
    a.search.exactPhrase === b.search.exactPhrase &&
    a.modal === b.modal &&
    a.busy === b.busy &&
    a.remindersFull === b.remindersFull &&
    a.undoOffered === b.undoOffered &&
    a.redoOffered === b.redoOffered &&
    a.linkAtCursor === b.linkAtCursor
  );
}

/** A state with nothing selected or edited, used before the renderer's first report. */
export function initialCommandState(): CommandState {
  return {
    view: "tasks",
    target: null,
    editing: "none",
    format: null,
    remindersExpanded: true,
    panelOpen: false,
    search: { active: false, everything: false, matchCase: false, exactPhrase: false },
    modal: "none",
    busy: false,
    remindersFull: false,
    undoOffered: false,
    redoOffered: false,
    linkAtCursor: false,
  };
}

export const MAX_SNAPSHOT_IDS = SNAPSHOT_IDS.length;
export const VALID_HEADINGS: readonly number[] = HEADING_LEVELS;
