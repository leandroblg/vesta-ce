/**
 * The one place that reads the shortcut map (007 research §10): a capture-phase keydown listener builds the
 * combination, finds the action for the current view, checks the action's rules and runs its handler.
 */
import type { ActionId, ActionView } from "../../domain/shortcuts/actions";
import { actionById } from "../../domain/shortcuts/actions";
import { fromKeyEvent, type Combo } from "../../domain/shortcuts/combo";
import { effectiveMap, actionFor, type ShortcutMap } from "../../domain/shortcuts/map";
import { activeEditor, editorFor } from "../editor/active";
import { useVesta } from "../store/store";
import { inEditor, inTextField } from "./editing";

/**
 * Returns false when the key was not used, so its native action goes on (an Enter on a button). Without an event,
 * the handler was run from the menu bar (013 research §2) and acts on the focused element.
 */
export type ShortcutHandler = (e?: KeyboardEvent) => boolean;

const handlers = new Map<ActionId, ShortcutHandler>();
/** 016 FR-003: the list redo of an undone reschedule; true when it acted (a redo notice showed). */
let listRedo: () => boolean = () => false;

/** Installed once by the keyboard handlers; Mod+Shift+Z outside text fields and Edit › Redo use it. */
export function registerListRedo(fn: () => boolean): () => void {
  listRedo = fn;
  return () => {
    if (listRedo === fn) listRedo = () => false;
  };
}

export function registerHandler(action: ActionId, fn: ShortcutHandler): () => void {
  handlers.set(action, fn);
  return () => {
    if (handlers.get(action) === fn) handlers.delete(action);
  };
}

let cached: { overrides: unknown; isMac: boolean; map: ShortcutMap } | null = null;

/** The live map: the stored overrides over the platform defaults. */
export function currentMap(): ShortcutMap {
  const { shortcuts, isMac } = useVesta.getState();
  if (cached?.overrides !== shortcuts || cached.isMac !== isMac) cached = { overrides: shortcuts, isMac, map: effectiveMap(shortcuts, isMac) };
  return cached.map;
}

export function comboOf(e: KeyboardEvent): Combo | null {
  return fromKeyEvent(e, useVesta.getState().isMac);
}

export function currentView(): ActionView {
  // 018 (research §4): the Archive and the Trash are separate views.
  const view = useVesta.getState().view;
  return view === "tasks" ? "main" : view;
}

/** The Close action's combination (FR-032): the inline editors and the details panel ask this, not `e.key`. */
export function isClose(e: KeyboardEvent | { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  const combo = fromKeyEvent(e, useVesta.getState().isMac);
  return combo !== null && currentMap().close.includes(combo);
}

/** Inside a text field or editor, Mod+Z and Mod+Shift+Z always undo and redo typing (FR-022, research §10). */
function textUndo(e: KeyboardEvent, combo: Combo): boolean {
  if (combo !== "Mod+Z" && combo !== "Mod+Shift+Z") return false;
  if (!inTextField(e.target)) return false;
  const redo = combo === "Mod+Shift+Z";
  const editor = activeEditor();
  if (editor !== null) {
    if (redo) editor.redo();
    else editor.undo();
  } else {
    // Native text undo has no replacement API for a menu-less key.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand(redo ? "redo" : "undo");
  }
  // One step per press: the editor's own keymap and the native field must not undo again (analysis U3).
  e.preventDefault();
  e.stopPropagation();
  return true;
}

/**
 * 012 FR-009: the key comes from inside the details editor, where the editor actions act; 013 T062: or from its own
 * floating menu, so Cmd/Ctrl+] works right after an Indent button press.
 */
function inDetailsEditor(target: EventTarget | null): boolean {
  return editorFor(target)?.scope === "details";
}

/** 013 FR-048: the key comes from inside any focused editor (title, reminder or details), where Format keys act. */
function inAnyEditor(target: EventTarget | null): boolean {
  return editorFor(target) !== null;
}

/** Whether the action may run now (FR-021, FR-022, CHK026). */
function allowed(action: ActionId, target: EventTarget | null): boolean {
  const s = useVesta.getState();
  const kind = actionById(action).kind;
  // 013 FR-019 (PRD Q183): About is modal; no shortcut acts behind it but Minimize window (its Esc is its own).
  if (s.aboutOpen) return action === "minimize";
  if (kind === "editor") return !s.settingsOpen && inDetailsEditor(target);
  if (kind === "global") {
    if (action === "minimize") return true;
    return !s.settingsOpen && s.overrideFor === null;
  }
  // 013 FR-048: a menu command acts where a global action does; its handler then asks whether its item is enabled.
  if (kind === "command") return !s.settingsOpen && s.overrideFor === null;
  if (kind === "format") return !s.settingsOpen && inAnyEditor(target);
  if (kind === "undo") return !s.settingsOpen && !inEditor(target);
  if (kind === "close") return false;
  return !s.settingsOpen && s.drag === null && !inEditor(target) && s.overrideFor === null && s.menuFor === null;
}

/**
 * 013 research §2: runs an action's handler as its key would, for the menu bar, gated by the same rules and acting
 * on the focused element. Returns whether the handler acted.
 */
export function runAction(action: ActionId): boolean {
  const target = document.activeElement;
  if (!allowed(action, target)) return false;
  const handler = handlers.get(action);
  return handler === undefined ? false : handler();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.isComposing || e.defaultPrevented) return;
  // A capture in progress receives its keys from main (research §11).
  if (useVesta.getState().capture !== null) return;
  const combo = comboOf(e);
  if (combo === null) return;
  if (textUndo(e, combo)) return;
  // 016 FR-007: outside text fields, Mod+Shift+Z redoes an undone reschedule while its notice shows; otherwise the
  // key goes to whatever action it is mapped to (007: a user may give it to another action).
  if (combo === "Mod+Shift+Z") {
    const s = useVesta.getState();
    if (!s.settingsOpen && !s.aboutOpen && !inEditor(e.target) && listRedo()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }
  const action = actionFor(combo, currentMap(), inAnyEditor(e.target) ? "editor" : currentView());
  if (action === null || !allowed(action, e.target)) return;
  const handler = handlers.get(action);
  if (handler === undefined) return;
  if (handler(e)) {
    e.preventDefault();
    const kind = actionById(action).kind;
    if (kind === "global" || kind === "command") e.stopPropagation();
  }
}

/** Installed once by App. */
export function installRegistry(): () => void {
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
  };
}

/** Edit → Undo and Edit → Redo clicked (research §10): text undo or redo in an editor; else the list undo or redo. */
export function menuUndoRedo(redo: boolean, listUndo: () => void): void {
  const editor = activeEditor();
  if (editor !== null) {
    if (redo) editor.redo();
    else editor.undo();
    return;
  }
  if (inTextField(document.activeElement)) {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand(redo ? "redo" : "undo");
    return;
  }
  if (redo) listRedo();
  else listUndo();
}
