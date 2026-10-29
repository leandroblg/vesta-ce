import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { MENU_COMMANDS, MENUS, commandsIn, menuCommand } from "../../../src/domain/menu/commands";
import { effectiveMap } from "../../../src/domain/shortcuts/map";
import { applyState, menuTemplate, representable, shownCombo, type MenuOptions } from "../../../src/main/menu";
import { createI18n } from "../../../src/shared/i18n";

type Item = MenuItemConstructorOptions;

function flatten(items: readonly Item[]): Item[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flatten(i.submenu) : [])]);
}

const opts = (isMac: boolean, over: Partial<MenuOptions> = {}): MenuOptions => ({
  isPackaged: true,
  t: createI18n("en").t,
  map: effectiveMap({}, isMac),
  isMac,
  windowShown: true,
  onCommand: vi.fn(),
  ...over,
});

/** A menu's items as ids, roles and "-" (submenus as their label then their items). */
function shape(items: readonly Item[]): string[] {
  return items.flatMap((i): string[] => {
    if (i.type === "separator") return ["-"];
    if (typeof i.role === "string" && i.role !== "appMenu") return [`role:${i.role}`];
    if (typeof i.id === "string") return [i.id];
    return [`[${String(i.label)}]`, ...(Array.isArray(i.submenu) ? shape(i.submenu).map((s) => `  ${s}`) : [])];
  });
}

describe("013 contracts/menu.md: the template for macOS and for Windows and Linux", () => {
  it.each([true, false])("menu titles in order (macOS: %s)", (isMac) => {
    const titles = menuTemplate(opts(isMac), isMac).map((m) => m.label);
    expect(titles).toEqual(isMac ? ["Vesta", "File", "Edit", "Format", "View", "Window", "Help"] : ["File", "Edit", "Format", "View", "Window", "Help"]);
  });

  it("development builds add Develop before Window", () => {
    const titles = menuTemplate(opts(true, { isPackaged: false }), true).map((m) => m.label);
    expect(titles).toEqual(["Vesta", "File", "Edit", "Format", "View", "Develop", "Window", "Help"]);
  });

  it.each([true, false])("each menu's items follow the command table (macOS: %s)", (isMac) => {
    const template = menuTemplate(opts(isMac), isMac);
    const specs = MENUS(isMac);
    expect(template).toHaveLength(specs.length);
    template.forEach((menu, i) => {
      const ids = flatten(Array.isArray(menu.submenu) ? menu.submenu : []).flatMap((x) => (typeof x.id === "string" ? [x.id] : []));
      const spec = specs[i];
      if (spec === undefined) throw new Error("missing spec");
      expect(ids).toEqual(commandsIn([spec]));
    });
  });

  it("macOS: Vesta holds About, Settings…, Check for Updates…, Services, Hide, Hide Others, Show All, Quit", () => {
    const app = menuTemplate(opts(true), true)[0] as Item;
    expect(app.role).toBe("appMenu");
    expect(shape(app.submenu as Item[])).toEqual([
      "about", "-", "settings", "checkUpdates", "-", "role:services", "-", "role:hide", "role:hideOthers", "role:unhide", "-", "role:quit",
    ]);
    const labels = (app.submenu as Item[]).filter((x) => x.type !== "separator").map((x) => x.label);
    expect(labels).toEqual(["About Vesta", "Settings…", "Check for Updates…", "Services", "Hide Vesta", "Hide Others", "Show All", "Quit Vesta"]);
  });

  it("Windows and Linux: File ends with Settings…, Check for Updates… and Quit; Window ends with Close; Help ends with About Vesta", () => {
    const [file, , , , win, help] = menuTemplate(opts(false), false);
    expect(shape(file?.submenu as Item[]).slice(-4)).toEqual(["settings", "checkUpdates", "-", "role:quit"]);
    expect(shape(win?.submenu as Item[]).at(-1)).toBe("role:close");
    expect(shape(help?.submenu as Item[]).slice(-2)).toEqual(["-", "about"]);
  });

  it("T115 FR-016 Format › Link… is a checkbox, so a linked selection shows its check mark; it keeps its ellipsis", () => {
    const link = menuCommand("fmt:link");
    expect(link.type).toBe("checkbox");
    expect(link.ellipsis).toBe(true);
  });

  it.each([true, false])("item types: checkboxes for toggles, radios for the views and the heading levels (macOS: %s)", (isMac) => {
    const items = flatten(menuTemplate(opts(isMac), isMac));
    for (const c of MENU_COMMANDS) {
      const item = items.find((x) => x.id === c.id);
      expect(item, c.id).toBeDefined();
      expect(item?.type, c.id).toBe(c.type);
      if (c.type === "checkbox") expect(typeof item?.checked, c.id).toBe("boolean");
    }
  });

  it.each([true, false])("every custom item's click sends its id (macOS: %s)", (isMac) => {
    const o = opts(isMac);
    for (const item of flatten(menuTemplate(o, isMac))) {
      if (typeof item.id !== "string") continue;
      (item.click as () => void)();
      expect(o.onCommand).toHaveBeenLastCalledWith(item.id);
    }
  });

  it("the heading levels read None and Heading 1 to Heading 6", () => {
    const items = flatten(menuTemplate(opts(true), true));
    expect([0, 1, 6].map((n) => items.find((x) => x.id === `fmt:heading-${String(n)}`)?.label)).toEqual(["None", "Heading 1", "Heading 6"]);
  });

  it("015 FR-010 FR-013 Edit › Postpone For shows the current durations as its labels", () => {
    const edit = (o: MenuOptions) => flatten(menuTemplate(o, true));
    const labels = (items: Item[]) => [1, 2, 3, 4].map((n) => items.find((x) => x.id === `postponeFor${String(n)}`)?.label);
    expect(labels(edit(opts(true)))).toEqual(["1h", "2h", "4h", "6h"]);
    expect(labels(edit(opts(true, { quickDurations: [60, 180, 240, 1530] })))).toEqual(["1h", "3h", "4h", "1d 1h 30m"]);
    expect(edit(opts(true)).find((x) => Array.isArray(x.submenu) && x.submenu.some((s) => s.id === "postponeFor1"))?.label).toBe("Postpone For");
  });

  it("a kept state sets enabled and checked at build time", () => {
    const items = flatten(menuTemplate(opts(true, { states: { done: { enabled: false }, "view:archive": { enabled: true, checked: true } } }), true));
    expect(items.find((x) => x.id === "done")?.enabled).toBe(false);
    expect(items.find((x) => x.id === "view:archive")?.checked).toBe(true);
  });
});

describe("013 FR-013 shown combinations", () => {
  it("the first combination, except Delete before Backspace on macOS shows Backspace", () => {
    expect(shownCombo(["Delete", "Backspace"], true)).toBe("Backspace");
    expect(shownCombo(["Delete", "Backspace"], false)).toBe("Delete");
    expect(shownCombo(["Mod+Alt+Backspace", "Delete", "Backspace"], true)).toBe("Mod+Alt+Backspace");
    expect(shownCombo([], true)).toBeNull();
  });

  it("CHK019 a combination Electron cannot draw shows none", () => {
    expect(representable("Mod+N")).toBe(true);
    expect(representable("Alt+ArrowUp")).toBe(true);
    expect(representable("Escape")).toBe(true);
    expect(representable("Mod+]")).toBe(true);
    expect(representable("Mod+Ç")).toBe(false);
  });
});

describe("013 research §3 applyState", () => {
  it("sets enabled and checked on items found by id, ignores unknown ids and leaves the rest", () => {
    const items: Record<string, { enabled: boolean; checked: boolean; type: string }> = {
      done: { enabled: true, checked: false, type: "normal" },
      "view:trash": { enabled: true, checked: false, type: "radio" },
    };
    applyState({ getMenuItemById: (id: string) => (id in items ? (items[id] as never) : null) }, {
      done: { enabled: false },
      "view:trash": { enabled: true, checked: true },
      showLogs: { enabled: false },
    });
    expect(items["done"]).toMatchObject({ enabled: false, checked: false });
    expect(items["view:trash"]).toMatchObject({ enabled: true, checked: true });
    applyState(null, { done: { enabled: true } });
  });
});

describe("013 FR-013, FR-014 accelerators from the shortcut map (T035)", () => {
  const item = (o: MenuOptions, isMac: boolean, id: string) => flatten(menuTemplate(o, isMac)).find((x) => x.id === id);

  it("every action-backed item shows its action's first combination, and a remap changes it", () => {
    expect(item(opts(true), true, "newTask")?.accelerator).toBe("CmdOrCtrl+N");
    expect(item(opts(true, { map: { ...effectiveMap({}, true), newTask: ["Mod+T"] } }), true, "newTask")?.accelerator).toBe("CmdOrCtrl+T");
    expect(item(opts(true, { map: { ...effectiveMap({}, true), newTask: [] } }), true, "newTask")?.accelerator).toBeUndefined();
  });

  it("Move to Trash shows Backspace on macOS and Delete elsewhere; Redo shows Mod+Shift+Z", () => {
    expect(item(opts(true), true, "trash")?.accelerator).toBe("Backspace");
    expect(item(opts(false), false, "trash")?.accelerator).toBe("Delete");
    expect(item(opts(true), true, "redo")?.accelerator).toBe("CmdOrCtrl+Shift+Z");
  });

  it("CHK019 a combination Electron cannot draw shows none", () => {
    expect(item(opts(true, { map: { ...effectiveMap({}, true), newTask: ["Mod+Ç"] } }), true, "newTask")?.accelerator).toBeUndefined();
  });

  it("FR-013 Format items show the editor's keys", () => {
    const items = flatten(menuTemplate(opts(true), true));
    const accel = (id: string) => items.find((x) => x.id === id)?.accelerator;
    expect([accel("fmt:strong"), accel("fmt:emphasis"), accel("fmt:inlineCode"), accel("fmt:strike_through")]).toEqual([
      "CmdOrCtrl+B", "CmdOrCtrl+I", "CmdOrCtrl+E", "CmdOrCtrl+Alt+X",
    ]);
    expect([accel("fmt:heading-0"), accel("fmt:heading-3"), accel("fmt:bullet"), accel("fmt:ordered"), accel("fmt:codeblock"), accel("fmt:quote")]).toEqual([
      "CmdOrCtrl+Alt+0", "CmdOrCtrl+Alt+3", "CmdOrCtrl+Alt+8", "CmdOrCtrl+Alt+7", "CmdOrCtrl+Alt+C", "CmdOrCtrl+Shift+B",
    ]);
    expect([accel("fmt:indent"), accel("fmt:outdent")]).toEqual(["CmdOrCtrl+]", "CmdOrCtrl+["]);
  });
});

describe("013 FR-011 labels: a literal & is escaped as && on Windows and Linux only (T037)", () => {
  const t = (key: string) => (key === "menuFind" ? "Find & Replace" : createI18n("en").t(key));
  it.each([
    [true, "Find & Replace"],
    [false, "Find && Replace"],
  ])("macOS: %s", (isMac, label) => {
    expect(flatten(menuTemplate(opts(isMac, { t }), isMac)).find((x) => x.id === "find")?.label).toBe(label);
  });
});

describe("013 FR-048 accelerators of the commands added by PRD Q186 (T098)", () => {
  const item = (o: MenuOptions, isMac: boolean, id: string) => flatten(menuTemplate(o, isMac)).find((x) => x.id === id);

  it("View items show Mod+1, Mod+2 and Mod+3", () => {
    expect(["view:tasks", "view:archive", "view:trash"].map((id) => item(opts(true), true, id)?.accelerator)).toEqual([
      "CmdOrCtrl+1", "CmdOrCtrl+2", "CmdOrCtrl+3",
    ]);
  });

  it("Delete Permanently shows ⌥⌘⌫ on macOS and Shift+Delete elsewhere, never Move to Trash's key", () => {
    expect(item(opts(true), true, "deleteForever")?.accelerator).toBe("CmdOrCtrl+Alt+Backspace");
    expect(item(opts(false), false, "deleteForever")?.accelerator).toBe("Shift+Delete");
  });

  it("an assigned Underline key shows on Format › Underline; unassigned, nothing", () => {
    expect(item(opts(false), false, "fmt:underline")?.accelerator).toBeUndefined();
    const map = { ...effectiveMap({}, false), "fmt:underline": ["Ctrl+Alt+U"] };
    expect(item(opts(false, { map }), false, "fmt:underline")?.accelerator).toBe("Ctrl+Alt+U");
  });

  it("Show Details shows Enter (the Open details action, PRD Q188)", () => {
    expect(item(opts(false), false, "showDetails")?.accelerator).toBe("Enter");
  });
});
