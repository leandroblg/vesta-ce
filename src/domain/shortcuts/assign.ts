/** Which combinations an action may take (007 FR-034, research §9 and §10). */
import { MENU_COMMANDS, type MenuCommandId } from "../menu/commands";
import { actionById, viewsOverlap, type ActionId } from "./actions";
import { parseCombo, type Combo } from "./combo";
import type { ShortcutMap } from "./map";

/** 013 FR-014: the label key of the menu item that holds a reserved combination, so the refusal can name it. */
export type ReservedItem =
  | "menuQuit"
  | "menuClose"
  | "menuHide"
  | "menuHideOthers"
  | "menuQuitOther"
  | "menuCloseOther"
  | "menuSelectAll"
  | "menuCopy"
  | "menuPaste"
  | "menuCut";

export type Refusal =
  | { reason: "inUse"; by: ActionId }
  | { reason: "editing" | "app"; item: ReservedItem }
  /** 013 FR-048: a Format key the editor keeps for itself, shown on this menu item (Bold, the headings…). */
  | { reason: "editor"; by: MenuCommandId }
  | { reason: "tab" | "printable" | "globalNeedsMod" | "invalid" };

export type AssignCheck = { ok: true } | ({ ok: false } & Refusal);

const EDITING_ITEMS: Readonly<Record<string, ReservedItem>> = { "Mod+A": "menuSelectAll", "Mod+C": "menuCopy", "Mod+V": "menuPaste", "Mod+X": "menuCut" };
const EDITING: readonly Combo[] = Object.keys(EDITING_ITEMS);

/**
 * The editor's own Format keys, which the menu only shows (`accel`), with the item that shows each; never remappable
 * (FR-048). Redo's Mod+Shift+Z stays assignable, as decided in 007 (analysis I1).
 */
const EDITOR_KEYS: ReadonlyMap<Combo, MenuCommandId> = new Map(
  MENU_COMMANDS.flatMap((c) => (c.accel === undefined || !c.id.startsWith("fmt:") ? [] : [[c.accel, c.id] as const])),
);

/** The menu item each reserved combination belongs to, on this platform. */
const APP_ITEMS = (isMac: boolean): Readonly<Record<string, ReservedItem>> =>
  isMac
    ? { "Mod+Q": "menuQuit", "Mod+W": "menuClose", "Mod+H": "menuHide", "Mod+Alt+H": "menuHideOthers" }
    : { "Mod+Q": "menuQuitOther", "Mod+W": "menuCloseOther", "Alt+F4": "menuCloseOther" };

/**
 * The combinations the application menu still registers, which never reach the renderer: quit, close, the
 * editing items, and Hide and Hide Others on macOS. Mod+Z, Mod+Shift+Z and Mod+M are not here: Undo, Redo and Minimize
 * register no accelerator (analysis I1, U5). `src/main/menu.ts` is checked against this list (analysis D1).
 */
export function RESERVED_COMBOS(isMac: boolean): readonly Combo[] {
  // 013 CHK035: Alt+F4 closes the window on Windows and Linux (the Close role).
  return [...Object.keys(APP_ITEMS(isMac)), ...EDITING];
}

/**
 * Refusals are checked in this order: tab, editing, app, editor, inUse, printable, globalNeedsMod (analysis A2).
 * Any other combination is accepted when no action holds it in an overlapping view.
 */
export function canAssign(action: ActionId, combo: Combo, map: ShortcutMap, isMac: boolean): AssignCheck {
  const p = parseCombo(combo);
  if (p === null) return { ok: false, reason: "invalid" };
  if (p.key === "Tab") return { ok: false, reason: "tab" };
  const editing = EDITING_ITEMS[combo];
  if (editing !== undefined) return { ok: false, reason: "editing", item: editing };
  const app = APP_ITEMS(isMac)[combo];
  if (app !== undefined) return { ok: false, reason: "app", item: app };
  const editor = EDITOR_KEYS.get(combo);
  if (editor !== undefined) return { ok: false, reason: "editor", by: editor };
  const target = actionById(action);
  for (const [id, combos] of Object.entries(map) as [ActionId, readonly Combo[]][]) {
    if (id === action || !combos.includes(combo)) continue;
    if (viewsOverlap(target, actionById(id))) return { ok: false, reason: "inUse", by: id };
  }
  const printable = p.key === "Space" || p.key.length === 1;
  if (printable && !p.mod && !p.alt && !p.ctrl) return { ok: false, reason: "printable" };
  const fKey = /^F([1-9]|1[0-2])$/.test(p.key);
  // 013 FR-048: a menu command acts from anywhere, the editors included, so it needs Mod as a global action does.
  if ((target.kind === "global" || target.kind === "command") && !p.mod && !fKey) return { ok: false, reason: "globalNeedsMod" };
  return { ok: true };
}
