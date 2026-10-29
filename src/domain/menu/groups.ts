/**
 * 013 FR-048 (analysis L1): the Settings shortcut table in one style: a first Lists group for the actions with no menu
 * command, then one group per menu, in the menu bar's order for the platform, each action once.
 */
import { SHORTCUT_ACTIONS, type ActionId } from "../shortcuts/actions";
import { MENUS, menuCommand, type MenuEntry } from "./commands";

export interface ShortcutGroup {
  labelKey: string;
  actions: ActionId[];
}

export function shortcutGroups(isMac: boolean): ShortcutGroup[] {
  const placed = new Set<ActionId>();
  const groups: ShortcutGroup[] = [];
  for (const menu of MENUS(isMac)) {
    const actions: ActionId[] = [];
    const walk = (entries: readonly MenuEntry[]) => {
      for (const e of entries) {
        if (e.kind === "submenu") walk(e.entries);
        if (e.kind !== "command") continue;
        const action = menuCommand(e.id).action;
        if (action === undefined || placed.has(action)) continue;
        placed.add(action);
        actions.push(action);
      }
    };
    walk(menu.entries);
    if (actions.length > 0) groups.push({ labelKey: menu.labelKey, actions });
  }
  const lists = SHORTCUT_ACTIONS.filter((a) => !placed.has(a.id)).map((a) => a.id);
  return [{ labelKey: "scGroupLists", actions: lists }, ...groups];
}

/** A row's label: its menu label without the ellipsis (FR-048). */
export function rowLabel(text: string): string {
  return text.replace(/…$/, "");
}
