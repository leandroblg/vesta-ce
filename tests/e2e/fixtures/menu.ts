/**
 * 013 T022 (research §2, contracts/ipc.md "Test hooks"): Playwright cannot open native menus, so tests click and
 * read the real application menu's items from the main process.
 */
import { expect, type ElectronApplication } from "@playwright/test";

export interface MenuItemView {
  label: string;
  enabled: boolean;
  checked: boolean;
  accelerator: string | null;
}

/** Clicks a menu item by id, as a click on the native menu would (main then sends menu:command). */
export async function clickMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (item === null || item === undefined) throw new Error(`no menu item ${itemId}`);
    (item.click as (event: unknown, win: unknown) => void)(undefined, BrowserWindow.getAllWindows()[0]);
  }, id);
}

/** A menu item's label, enabled and checked states and accelerator. */
export async function menuItem(app: ElectronApplication, id: string): Promise<MenuItemView> {
  return app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (item === null || item === undefined) throw new Error(`no menu item ${itemId}`);
    return { label: item.label, enabled: item.enabled, checked: item.checked, accelerator: item.accelerator ?? null };
  }, id);
}

/** The top-level menus' titles, in order. */
export async function menuTitles(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label) ?? []);
}

/** Every item label of every menu, submenus flattened, separators left out. */
export async function menuLabels(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ Menu }) => {
    const out: string[] = [];
    const walk = (items: Electron.MenuItem[]) => {
      for (const i of items) {
        if (i.type === "separator") continue;
        out.push(i.label);
        // Electron reports `null` for an item without a submenu, though its types say `undefined`.
        const sub = i.submenu as Electron.Menu | null | undefined;
        if (sub !== null && sub !== undefined) walk(sub.items);
      }
    };
    walk(Menu.getApplicationMenu()?.items ?? []);
    return out;
  });
}

/** Waits until the renderer's published state has reached the item (research §3: one frame, then IPC). */
export async function waitMenuState(app: ElectronApplication, id: string, want: Partial<Pick<MenuItemView, "enabled" | "checked">>): Promise<void> {
  await expect
    .poll(async () => {
      const item = await menuItem(app, id);
      return (want.enabled === undefined || item.enabled === want.enabled) && (want.checked === undefined || item.checked === want.checked);
    }, { message: `${id} ${JSON.stringify(want)}` })
    .toBe(true);
}
