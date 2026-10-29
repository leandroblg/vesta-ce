/**
 * Application menu (001 FR-047; 007 research §4, §10, §13; 013 FR-001 to FR-014, research §1, §5, §6,
 * contracts/menu.md): built from the domain's command table, every label from the active language, every
 * accelerator from the shortcut map. Custom items register no accelerator, so their keys reach the renderer's
 * registry and the editor; the roles' combinations are the domain's RESERVED_COMBOS. While the window is hidden on
 * macOS, the global commands register theirs, so the shortcut brings the window back (research §6).
 */
import { Menu, type MenuItemConstructorOptions } from "electron";
import { formatDuration } from "../domain/age";
import { DEFAULT_ALERT_SETTINGS, quickDurations } from "../domain/alert-settings";
import { MENUS, menuCommand, type MenuCommandId, type MenuEntry } from "../domain/menu/commands";
import type { ItemState } from "../domain/menu/enablement";
import { parseCombo, type Combo } from "../domain/shortcuts/combo";
import type { ShortcutMap } from "../domain/shortcuts/map";

export interface MenuOptions {
  isPackaged: boolean;
  /** The main-side translator in the active language (constitution V). */
  t: (key: string, params?: Record<string, string | number>) => string;
  /** The effective shortcut map: the accelerator shown beside each item (FR-013). */
  map: ShortcutMap;
  isMac: boolean;
  /** False while the window is hidden on macOS (FR-020). */
  windowShown: boolean;
  /** The last enabled and checked states, kept across rebuilds (research §3). */
  states?: Partial<Record<MenuCommandId, ItemState>>;
  /** A custom item was clicked. */
  onCommand: (id: MenuCommandId) => void;
  /** 015 FR-010, FR-013: the four quick durations in minutes, the Postpone For labels (defaults when absent). */
  quickDurations?: readonly [number, number, number, number];
}

const KEY_ACCELERATOR: Readonly<Record<string, string>> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Esc",
  "+": "Plus",
};

/** Vesta's combination → Electron's accelerator text, for display (analysis U4): `Mod+U` → `CmdOrCtrl+U`. */
export function toAccelerator(combo: Combo): string {
  const p = parseCombo(combo);
  if (p === null) return combo;
  const parts: string[] = [];
  if (p.mod) parts.push("CmdOrCtrl");
  if (p.ctrl) parts.push("Ctrl");
  if (p.shift) parts.push("Shift");
  if (p.alt) parts.push("Alt");
  parts.push(KEY_ACCELERATOR[p.key] ?? p.key);
  return parts.join("+");
}

const NAMED_KEYS = new Set([
  "Up",
  "Down",
  "Left",
  "Right",
  "Esc",
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Space",
  "Plus",
]);

/** Whether Electron can draw the combination as an accelerator (FR-013, CHK019); others show none. */
export function representable(combo: Combo): boolean {
  const p = parseCombo(combo);
  if (p === null) return false;
  const key = KEY_ACCELERATOR[p.key] ?? p.key;
  return NAMED_KEYS.has(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || /^[A-Z0-9,./;'[\]\\`=-]$/.test(key);
}

/** The combination an item shows: the first one, except that Move to Trash shows ⌫ on macOS (FR-013). */
export function shownCombo(combos: readonly Combo[], isMac: boolean): Combo | null {
  const first = combos[0];
  if (first === undefined) return null;
  if (isMac && first === "Delete" && combos.includes("Backspace")) return "Backspace";
  return first;
}

/** Commands whose accelerators are registered while the window is hidden (research §6). */
const HIDDEN_GLOBALS: ReadonlySet<MenuCommandId> = new Set<MenuCommandId>(["newTask", "newRem", "find", "settings"]);

export function buildMenu(options: MenuOptions): Menu {
  return Menu.buildFromTemplate(menuTemplate(options, options.isMac));
}

/** On Windows and Linux a literal "&" would be read as an access key (FR-011, research §18). */
function labelFor(text: string, isMac: boolean): string {
  return isMac ? text : text.replaceAll("&", "&&");
}

function commandItem(id: MenuCommandId, o: MenuOptions, isMac: boolean): MenuItemConstructorOptions {
  const c = menuCommand(id);
  const level = /^fmt:heading-(\d)$/.exec(id)?.[1];
  const text =
    c.duration !== undefined
      ? formatDuration((o.quickDurations ?? quickDurations(DEFAULT_ALERT_SETTINGS))[c.duration], { d: o.t("unitD"), h: o.t("unitH"), m: o.t("unitM") })
      : level !== undefined && level !== "0"
        ? o.t(c.labelKey, { n: level })
        : o.t(c.labelKey);
  const label = labelFor(text, isMac);
  const combo = c.accel ?? (c.action === undefined ? null : shownCombo(o.map[c.action], isMac));
  const register = !o.windowShown && HIDDEN_GLOBALS.has(id);
  const state = o.states?.[id];
  const item: MenuItemConstructorOptions = {
    id,
    label,
    type: c.type,
    enabled: state?.enabled ?? true,
    click: () => {
      o.onCommand(id);
    },
  };
  // A radio item is only ever set checked; Electron unchecks the rest of its group (setting false checks another).
  if (c.type === "checkbox") item.checked = state?.checked ?? false;
  else if (c.type === "radio" && state?.checked === true) item.checked = true;
  if (combo !== null && representable(combo)) {
    item.accelerator = toAccelerator(combo);
    if (!register) item.registerAccelerator = false;
  } else if (!register) item.registerAccelerator = false;
  return item;
}

function entries(list: readonly MenuEntry[], o: MenuOptions, isMac: boolean): MenuItemConstructorOptions[] {
  return list.map((e): MenuItemConstructorOptions => {
    if (e.kind === "separator") return { type: "separator" };
    if (e.kind === "role") return { role: e.role, label: labelFor(o.t(e.labelKey), isMac) };
    if (e.kind === "submenu") return { label: labelFor(o.t(e.labelKey), isMac), submenu: entries(e.entries, o, isMac) };
    return commandItem(e.id, o, isMac);
  });
}

/** Pure template, unit-tested for macOS and for Windows and Linux (contracts/menu.md). */
export function menuTemplate(o: MenuOptions, isMac: boolean): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  for (const menu of MENUS(isMac)) {
    if (menu.id === "window" && !o.isPackaged) {
      // Development builds only; no accelerators, so Mod+Shift+R reaches New reminder there too (research §13).
      template.push({
        label: o.t("menuDevelop"),
        submenu: [
          { role: "reload", label: o.t("menuReload"), registerAccelerator: false },
          { role: "forceReload", label: o.t("menuForceReload"), registerAccelerator: false },
          { role: "toggleDevTools", label: o.t("menuDevTools"), registerAccelerator: false },
        ],
      });
    }
    const item: MenuItemConstructorOptions = { label: labelFor(o.t(menu.labelKey), isMac), submenu: entries(menu.entries, o, isMac) };
    if (menu.id === "app") item.role = "appMenu";
    template.push(item);
  }
  return template;
}

/** Sets `enabled` and `checked` on the built menu's items by id (research §3); roles are left alone. */
export function applyState(menu: Pick<Menu, "getMenuItemById"> | null, states: Partial<Record<MenuCommandId, ItemState>>): void {
  if (menu === null) return;
  for (const [id, state] of Object.entries(states) as [MenuCommandId, ItemState][]) {
    const item = menu.getMenuItemById(id);
    if (item === null) continue;
    item.enabled = state.enabled;
    if (state.checked === undefined) continue;
    if (item.type === "checkbox") item.checked = state.checked;
    // Electron keeps one radio of a group checked: set the checked one, and the others follow.
    else if (item.type === "radio" && state.checked && !item.checked) item.checked = true;
  }
}
