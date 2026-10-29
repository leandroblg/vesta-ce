/** The handlers of the shortcut actions (007 FR-020 to FR-031b), registered once by App. */
import type { KeyMove } from "../../domain/move";
import { visibleRedoToken, visibleUndoToken } from "../../domain/notifications";
import { keyboardMove } from "../features/tasks/drag/keyboard";
import { SEARCH_INPUT_ID } from "../features/search/SearchBox";
import { rememberOpener } from "../features/settings/SettingsDialog";
import { flushAll } from "../store/flush";
import { actions, useVesta } from "../store/store";
import { activeEditor, editorFor } from "../editor/active";
import { registerHandler, registerListRedo } from "./registry";
import { installSelectionHandlers } from "./selection";

/** The element that had focus when Settings opened: a card id, else "cog" (research §8). */
function returnFocusTarget(): string {
  const el = document.activeElement;
  const card = el instanceof HTMLElement ? el.closest<HTMLElement>("li[data-id]") : null;
  return card?.dataset["id"] ?? "cog";
}

/** Opens Settings after saving pending edits, as Focus search does (research §8). */
export function openSettings(): void {
  if (useVesta.getState().settingsOpen) return;
  rememberOpener();
  const target = returnFocusTarget();
  void flushAll().finally(() => {
    actions.openSettings(target);
  });
}

export function installShortcutHandlers(): () => void {
  const move = (key: KeyMove) => (e?: KeyboardEvent) => keyboardMove(e?.target ?? document.activeElement, key);
  const off = [
    // 006 FR-021: focus the search box and select its text, pending edits saved first.
    registerHandler("search", () => {
      const input = document.getElementById(SEARCH_INPUT_ID);
      if (!(input instanceof HTMLInputElement)) return false;
      void flushAll().finally(() => {
        input.focus();
        input.select();
      });
      return true;
    }),
    // 012 FR-009: list items in the details editor, one level deeper or up.
    // 013 T062: also with the focus on the editor's own menu, right after a button press.
    registerHandler("indentItem", () => (editorFor(document.activeElement) ?? activeEditor())?.indent(1) ?? false),
    registerHandler("outdentItem", () => (editorFor(document.activeElement) ?? activeEditor())?.indent(-1) ?? false),
    registerHandler("moveUp", move("up")),
    registerHandler("moveDown", move("down")),
    registerHandler("promote", move("promote")),
    registerHandler("demote", move("demote")),
    // 001 FR-029: undoes the action of the visible undo notification, outside editors (research §10).
    registerHandler("undo", () => {
      if (visibleUndoToken(useVesta.getState().notifications) === null) return false;
      void actions.undo();
      return true;
    }),
    // 016 FR-003, FR-007: redoes an undone reschedule while its notice shows, outside text fields.
    registerListRedo(() => {
      if (visibleRedoToken(useVesta.getState().notifications) === null) return false;
      void actions.redo();
      return true;
    }),
    registerHandler("settings", () => {
      openSettings();
      return true;
    }),
    registerHandler("minimize", () => {
      actions.minimize();
      return true;
    }),
    installSelectionHandlers(),
  ];
  return () => {
    for (const f of off) f();
  };
}
