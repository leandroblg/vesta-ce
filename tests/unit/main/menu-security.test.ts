import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { LANGS } from "../../../src/domain/language";
import { RESERVED_COMBOS } from "../../../src/domain/shortcuts/assign";
import { effectiveMap } from "../../../src/domain/shortcuts/map";
import { menuTemplate, toAccelerator, type MenuOptions } from "../../../src/main/menu";
import { createI18n } from "../../../src/shared/i18n";

type Item = MenuItemConstructorOptions;

function flatten(items: readonly Item[]): Item[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flatten(i.submenu) : [])]);
}

const roles = (items: readonly Item[]) => flatten(items).flatMap((i) => (typeof i.role === "string" ? [i.role] : []));

const opts = (over: Partial<MenuOptions> = {}): MenuOptions => ({
  isPackaged: true,
  t: createI18n("en").t,
  map: effectiveMap({}, over.isMac ?? true),
  isMac: true,
  windowShown: true,
  onCommand: vi.fn(),
  ...over,
});

/** Electron's default accelerators of the roles the template uses (when the item does not opt out). */
function roleAccelerator(role: string, isMac: boolean): string | null {
  const table: Record<string, string> = {
    hide: "Mod+H",
    hideOthers: "Mod+Alt+H",
    quit: "Mod+Q",
    close: "Mod+W",
    cut: "Mod+X",
    copy: "Mod+C",
    paste: "Mod+V",
    selectAll: "Mod+A",
    reload: "Mod+R",
    forceReload: "Mod+Shift+R",
    toggleDevTools: isMac ? "Mod+Alt+I" : "Mod+Shift+I",
  };
  return table[role] ?? null;
}

/** Every combination the template registers with Electron, as Vesta combinations. */
function registered(template: readonly Item[], isMac: boolean): string[] {
  return flatten(template).flatMap((i) => {
    if (i.registerAccelerator === false) return [];
    if (typeof i.accelerator === "string") return [i.accelerator.replace("CmdOrCtrl", "Mod").replace("Up", "ArrowUp")];
    const r = typeof i.role === "string" ? roleAccelerator(i.role, isMac) : null;
    return r === null ? [] : [r];
  });
}

describe("application menu (001 FR-047; 007 research §4, §10, §13)", () => {
  it.each([true, false])("released builds have no reload or devtools roles (macOS: %s)", (isMac) => {
    const r = roles(menuTemplate(opts(), isMac));
    expect(r).not.toContain("reload");
    expect(r).not.toContain("forceReload");
    expect(r).not.toContain("toggleDevTools");
  });

  it.each([true, false])("no build registers Cmd/Ctrl+R or Cmd/Ctrl+Shift+R (macOS: %s; analysis R1)", (isMac) => {
    for (const isPackaged of [true, false]) {
      const combos = registered(menuTemplate(opts({ isPackaged }), isMac), isMac);
      expect(combos).not.toContain("Mod+R");
      expect(combos).not.toContain("Mod+Shift+R");
    }
  });

  it("development builds keep reload and devtools, without registered accelerators", () => {
    const items = flatten(menuTemplate(opts({ isPackaged: false }), false));
    const dev = items.filter((i) => i.role === "reload" || i.role === "forceReload" || i.role === "toggleDevTools");
    expect(dev).toHaveLength(3);
    for (const i of dev) expect(i.registerAccelerator).toBe(false);
  });

  it("Edit → Undo and Redo are custom items that register no accelerator and send their commands", () => {
    const o = opts({ map: { ...effectiveMap({}, true), undo: ["Mod+U"] } });
    const items = flatten(menuTemplate(o, true));
    const undo = items.find((i) => i.id === "undo");
    const redo = items.find((i) => i.id === "redo");
    expect(undo).toMatchObject({ label: "Undo", accelerator: "CmdOrCtrl+U", registerAccelerator: false });
    expect(redo).toMatchObject({ label: "Redo", accelerator: "CmdOrCtrl+Shift+Z", registerAccelerator: false });
    expect(roles(items)).not.toContain("undo");
    expect(roles(items)).not.toContain("redo");
    (undo?.click as () => void)();
    (redo?.click as () => void)();
    expect(o.onCommand).toHaveBeenNthCalledWith(1, "undo");
    expect(o.onCommand).toHaveBeenNthCalledWith(2, "redo");
  });

  it.each([true, false])("the Window menu is explicit; Minimize follows the action (macOS: %s; analysis U5)", (isMac) => {
    const o = opts({ isMac, map: effectiveMap({}, isMac) });
    const template = menuTemplate(o, isMac);
    expect(roles(template)).not.toContain("windowMenu");
    const min = flatten(template).find((i) => i.id === "minimize");
    expect(min).toMatchObject({ label: "Minimize", registerAccelerator: false });
    expect(min?.accelerator).toBe(isMac ? "CmdOrCtrl+M" : undefined);
    (min?.click as () => void)();
    expect(o.onCommand).toHaveBeenCalledWith("minimize");
    if (isMac) expect(roles(template)).toEqual(expect.arrayContaining(["zoom", "front"]));
    else expect(roles(template)).toContain("close");
  });

  it.each([true, false])("every accelerator the template registers is reserved in the domain (macOS: %s; analysis D1)", (isMac) => {
    for (const isPackaged of [true, false]) {
      // 013 research §6: while shown, only the roles' combinations are registered.
      for (const c of registered(menuTemplate(opts({ isPackaged, isMac, map: effectiveMap({}, isMac) }), isMac), isMac)) {
        expect(RESERVED_COMBOS(isMac), c).toContain(c);
      }
    }
  });

  it.each(LANGS)("every item has an explicit label in %s", (lang) => {
    const t = createI18n(lang).t;
    for (const isMac of [true, false]) {
      for (const i of flatten(menuTemplate(opts({ t, isPackaged: false }), isMac))) {
        if (i.type === "separator") continue;
        expect(typeof i.label, JSON.stringify(i.role ?? i.id)).toBe("string");
        expect(i.label).not.toMatch(/^menu[A-Z]/);
      }
    }
  });
});

describe("013 research §6 the hidden window (macOS)", () => {
  it("while hidden, New Task, New Reminder, Find and Settings register their accelerators; nothing else does", () => {
    const items = flatten(menuTemplate(opts({ windowShown: false }), true));
    const custom = items.filter((i) => typeof i.id === "string" && i.registerAccelerator !== false && typeof i.accelerator === "string");
    expect(custom.map((i) => i.id).sort()).toEqual(["find", "newRem", "newTask", "settings"]);
  });

  it("while shown, no custom item registers its accelerator", () => {
    for (const isMac of [true, false]) {
      const items = flatten(menuTemplate(opts({ isMac, map: effectiveMap({}, isMac) }), isMac));
      for (const i of items) if (typeof i.id === "string") expect(i.registerAccelerator, i.id).toBe(false);
    }
  });
});

describe("toAccelerator (analysis U4)", () => {
  it.each([
    ["Mod+U", "CmdOrCtrl+U"],
    ["Mod+Shift+Z", "CmdOrCtrl+Shift+Z"],
    ["Alt+ArrowUp", "Alt+Up"],
    ["Escape", "Esc"],
    ["Mod+,", "CmdOrCtrl+,"],
    ["F5", "F5"],
    ["Ctrl+N", "Ctrl+N"],
  ])("%s → %s", (combo, accel) => {
    expect(toAccelerator(combo)).toBe(accel);
  });
});

describe("L5 no developer tools in a packaged build (010 FR-021)", () => {
  it("L5 the packaged menu has no devtools role and no devtools accelerator", () => {
    for (const isMac of [false, true]) {
      const items = flatten(menuTemplate(opts({ isPackaged: true }), isMac));
      expect(roles(items)).not.toContain("toggleDevTools");
      for (const item of items) {
        if (typeof item.accelerator === "string") expect(item.accelerator).not.toMatch(/Shift\+I$|Alt\+I$|Option\+I$/);
      }
    }
  });
});
