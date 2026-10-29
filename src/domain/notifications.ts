/**
 * The single bottom-center notification slot (FR-025 to FR-028, FR-040 to FR-042a; research.md §10).
 * Pure: the caller passes `now` with every event.
 */

export const UNDO_MS = 10_000;
export const INFO_MS = 10_000;
/** Undo import's offer (008 FR-037b): the notice's deadline comes from main, 60 s after the import. */
export const IMPORT_UNDO_MS = 60_000;
export const IMPORT_RESULT_MS = 10_000;

export type UndoKind = "done" | "delete" | "restore" | "reschedule";

export type StickyNotice =
  | { type: "sticky"; kind: "saveFailed" }
  | { type: "sticky"; kind: "folderNotWritable"; path: string }
  | { type: "sticky"; kind: "dataDamaged" }
  | { type: "sticky"; kind: "backupRestored"; backupAt: number; moved: { count: number; folder: string } | null }
  | { type: "sticky"; kind: "unrecoverable"; damagedPath: string }
  /** 010 FR-026 (L16): the previous run ended with an uncaught exception at `at`; the notice links to the logs. */
  | { type: "sticky"; kind: "abnormalExit"; at: number }
  /** 017 FR-015a (PRD Q263): the data was saved by a newer version of Vesta and is refused. */
  | { type: "sticky"; kind: "newerData" };

export interface UndoNotice {
  type: "undo";
  kind: UndoKind;
  token: string;
  /** The item's text, named in the banner (HIG identity §9); empty when unknown. */
  title: string;
  shownAt: number;
}

/** 016 FR-003 (PRD Q228): after an Undo of a reschedule, Redo for the same 10 s; gone on any list action (Q256). */
export interface RedoNotice {
  type: "redo";
  token: string;
  title: string;
  shownAt: number;
}

export interface InfoNotice {
  type: "info";
  kind: "backupFailed";
  lastBackupAt: number | null;
  shownAt: number;
}

/** A successful import's result with Undo import (008 FR-037b, PRD Q121): it behaves like an undo notice. */
export interface ImportUndoNotice {
  type: "importUndo";
  token: string;
  counts: { added: number; updated: number; unchanged: number };
  shownAt: number;
  deadline: number;
}

/** What Undo import did, in the same place for 10 s. */
export interface ImportResultNotice {
  type: "importResult";
  kind: "undone" | "undoFailed";
  shownAt: number;
}

/**
 * 009 FR-024: a newer Vesta exists. It stays until closed, waits while any other notice shows, never replaces
 * one, and goes back to waiting when displaced. Opening Settings drops it (FR-024a).
 */
export interface UpdateNotice {
  type: "update";
  version: string;
  shownAt: number;
}

/**
 * 010 FR-033 (PRD Q133): a reminder to check for updates while automatic checks are off. The update notice's rules:
 * it waits while any other notice shows, never replaces one, goes back to waiting when displaced, stays until closed.
 */
export interface ReminderNotice {
  type: "reminder";
  shownAt: number;
}

export type Notice = UndoNotice | RedoNotice | InfoNotice | StickyNotice | ImportUndoNotice | ImportResultNotice | UpdateNotice | ReminderNotice;

/** Stickies, infos, the update notice or the reminder waiting for the slot. */
type Waiting = InfoNotice | StickyNotice | UpdateNotice | ReminderNotice;

export interface NotificationState {
  current: Notice | null;
  waiting: readonly Waiting[];
}

type StickyPayload = StickyNotice extends infer S ? (S extends StickyNotice ? Omit<S, "type"> : never) : never;

export type NotificationEvent =
  | { type: "showUndo"; kind: UndoKind; token: string; title?: string }
  | { type: "showRedo"; token: string; title?: string }
  /** 016 FR-006: any task or reminder change that is not itself undoable; it dismisses a Redo notice only. */
  | { type: "listAction" }
  | { type: "showImportUndo"; token: string; counts: ImportUndoNotice["counts"]; deadline: number }
  | { type: "importUndone" }
  | { type: "importUndoFailed" }
  | ({ type: "showInfo" } & Omit<InfoNotice, "type" | "shownAt">)
  | ({ type: "showSticky" } & StickyPayload)
  | { type: "showUpdate"; version: string }
  | { type: "dropUpdate" }
  | { type: "showReminder" }
  | { type: "dropReminder" }
  | { type: "close" }
  | { type: "tick" };

export const initialNotifications: NotificationState = { current: null, waiting: [] };

/** Stickies that the spec says replace whatever shows. */
const REPLACES_ANY: ReadonlySet<StickyNotice["kind"]> = new Set(["dataDamaged", "backupRestored"]);

export function visible(state: NotificationState): Notice | null {
  return state.current;
}

export function visibleUndoToken(state: NotificationState): string | null {
  return state.current?.type === "undo" ? state.current.token : null;
}

/** 016 FR-003: the Redo token while its notice shows. */
export function visibleRedoToken(state: NotificationState): string | null {
  return state.current?.type === "redo" ? state.current.token : null;
}

/** The Undo import token while its notice shows; Cmd/Ctrl+Z never uses it (FR-037b). */
export function visibleImportUndoToken(state: NotificationState): string | null {
  return state.current?.type === "importUndo" ? state.current.token : null;
}

const kindOf = (n: Notice): string => (n.type === "importUndo" || n.type === "redo" || n.type === "update" || n.type === "reminder" ? "" : n.kind);
const sameKind = (a: Notice, b: Notice) => a.type === b.type && kindOf(a) === kindOf(b);
/** Notices that are simply gone when another one takes the slot. */
const isTransient = (n: Notice) => n.type === "undo" || n.type === "redo" || n.type === "importUndo" || n.type === "importResult";

function pullNext(waiting: readonly Waiting[], now: number): NotificationState {
  const [next, ...rest] = waiting;
  if (next === undefined) return { current: null, waiting: [] };
  return { current: next.type === "sticky" ? next : { ...next, shownAt: now }, waiting: rest };
}

/** What happens to the notice that a newly shown one displaces. */
function displaced(current: Notice | null, waiting: readonly Waiting[]): readonly Waiting[] {
  if (current === null || isTransient(current)) return waiting; // an undo or import notice is simply gone
  return [current, ...waiting.filter((w) => !sameKind(w, current))];
}

function enqueue(waiting: readonly Waiting[], notice: Waiting): readonly Waiting[] {
  return waiting.some((w) => sameKind(w, notice)) ? waiting : [...waiting, notice];
}

export function reduce(state: NotificationState, event: NotificationEvent, now: number): NotificationState {
  const { current, waiting } = state;
  switch (event.type) {
    case "showUndo": {
      if (current?.type === "sticky") return state; // FR-028: no undo while a sticky shows
      const undo: UndoNotice = { type: "undo", kind: event.kind, token: event.token, title: event.title ?? "", shownAt: now };
      return { current: undo, waiting: displaced(current, waiting) };
    }
    case "showRedo": {
      if (current?.type === "sticky") return state; // as an undo: not over a sticky
      const redo: RedoNotice = { type: "redo", token: event.token, title: event.title ?? "", shownAt: now };
      return { current: redo, waiting: displaced(current, waiting) };
    }
    case "listAction":
      return current?.type === "redo" ? pullNext(waiting, now) : state;
    case "showImportUndo": {
      if (current?.type === "sticky") return state; // as an undo: not over a sticky
      const notice: ImportUndoNotice = { type: "importUndo", token: event.token, counts: event.counts, shownAt: now, deadline: event.deadline };
      return { current: notice, waiting: displaced(current, waiting) };
    }
    case "importUndone":
    case "importUndoFailed": {
      const result: ImportResultNotice = { type: "importResult", kind: event.type === "importUndone" ? "undone" : "undoFailed", shownAt: now };
      return { current: result, waiting: displaced(current, waiting) };
    }
    case "showInfo": {
      const info: InfoNotice = { type: "info", kind: event.kind, lastBackupAt: event.lastBackupAt, shownAt: now };
      if (current === null) return { current: info, waiting };
      if (sameKind(current, info)) return state;
      return { current, waiting: enqueue(waiting, info) };
    }
    case "showSticky": {
      const { type: _type, ...payload } = event;
      const sticky = { type: "sticky", ...payload } as StickyNotice;
      if (current !== null && sameKind(current, sticky)) return state;
      // 017 PRD Q269: "Changes are not saved" takes the newer-data notice's place, which returns when it is closed.
      const overNewerData = current?.type === "sticky" && current.kind === "newerData" && sticky.kind === "saveFailed";
      if (current?.type === "sticky" && !REPLACES_ANY.has(sticky.kind) && !overNewerData) {
        return { current, waiting: enqueue(waiting, sticky) };
      }
      const rest = displaced(current, waiting).filter((w) => !sameKind(w, sticky));
      return { current: sticky, waiting: rest };
    }
    case "showUpdate": {
      // A newer version replaces an older one wherever it is; it never takes the slot from another notice.
      const notice: UpdateNotice = { type: "update", version: event.version, shownAt: now };
      const rest = waiting.filter((w) => w.type !== "update");
      if (current === null || current.type === "update") return { current: notice, waiting: rest };
      return { current, waiting: [...rest, notice] };
    }
    case "dropUpdate": {
      const rest = waiting.filter((w) => w.type !== "update");
      if (current?.type === "update") return pullNext(rest, now);
      return rest.length === waiting.length ? state : { current, waiting: rest };
    }
    case "showReminder": {
      // One reminder at a time; it never takes the slot from another notice (010 FR-033).
      if (current?.type === "reminder" || waiting.some((w) => w.type === "reminder")) return state;
      const notice: ReminderNotice = { type: "reminder", shownAt: now };
      if (current === null) return { current: notice, waiting };
      return { current, waiting: [...waiting, notice] };
    }
    case "dropReminder": {
      const rest = waiting.filter((w) => w.type !== "reminder");
      if (current?.type === "reminder") return pullNext(rest, now);
      return rest.length === waiting.length ? state : { current, waiting: rest };
    }
    case "close":
      return pullNext(waiting, now);
    case "tick": {
      if (current === null || current.type === "sticky" || current.type === "update" || current.type === "reminder") return state;
      if (current.type === "importUndo") return now >= current.deadline ? pullNext(waiting, now) : state;
      const limit = current.type === "undo" || current.type === "redo" ? UNDO_MS : current.type === "importResult" ? IMPORT_RESULT_MS : INFO_MS;
      return now - current.shownAt >= limit ? pullNext(waiting, now) : state;
    }
  }
}
