// 013 T015, T017 (research §3, §6): main keeps the renderer's state and applies it to the built menu.
import { describe, expect, it, vi } from "vitest";
import { MENU_COMMANDS } from "../../../src/domain/menu/commands";
import { initialCommandState } from "../../../src/domain/menu/state";
import { effectiveMap } from "../../../src/domain/shortcuts/map";
import { buildMenuHandlers } from "../../../src/main/ipc/menu-handlers";
import { MenuController } from "../../../src/main/menu-controller";
import type { MenuOptions } from "../../../src/main/menu";
import { createI18n } from "../../../src/shared/i18n";
import { budget } from "../perf-budget";

function fakeMenu(ids: readonly { id: string; type: string }[] = ["done", "newTask", "view:trash"].map((id) => ({ id, type: id.startsWith("view:") ? "radio" : "normal" }))) {
  const items = new Map<string, { enabled: boolean; checked: boolean; type: string }>();
  for (const { id, type } of ids) items.set(id, { enabled: true, checked: false, type });
  const getMenuItemById = (id: string) => (items.has(id) ? (items.get(id) as never) : null);
  return { items, menu: { getMenuItemById } };
}

function controller(fake = fakeMenu()) {
  const installs: MenuOptions[] = [];
  const c = new MenuController({
    install: (options) => {
      installs.push(options);
      return fake.menu;
    },
    options: () => ({ isPackaged: true, t: createI18n("en").t, map: effectiveMap({}, true), isMac: true, onCommand: vi.fn() }),
  });
  c.rebuild();
  return { c, fake, installs };
}

describe("013 research §3 the menu controller", () => {
  it("T017 menu:set-state stores the state and applies enablement", () => {
    const { c, fake } = controller();
    const handlers = buildMenuHandlers({
      setMenuState: (s) => {
        c.setState(s);
      },
      confirmDeleteForever: () => Promise.resolve(true),
      helpUrls: () => ({ readme: "r", release: "v" }),
      openExternal: () => Promise.resolve(),
      log: { warn: vi.fn() },
    });
    const state = { ...initialCommandState(), view: "trash" as const, target: { kind: "task" as const, topLevel: true, stale: false } };
    expect(handlers.handlers["menu:set-state"]?.(state)).toBeNull();
    expect(c.commandState).toEqual(state);
    expect(fake.items.get("done")?.enabled).toBe(false);
    expect(fake.items.get("view:trash")).toMatchObject({ checked: true });
  });

  it("a rebuild carries the last state into the new menu", () => {
    const { c, installs } = controller();
    c.setState({ ...initialCommandState(), modal: "about" });
    c.rebuild();
    expect(installs.at(-1)?.states?.newTask?.enabled).toBe(false);
  });

  it("FR-020 hiding the window rebuilds once with windowShown false; showing it again rebuilds", () => {
    const { c, installs } = controller();
    c.setWindowShown(false);
    c.setWindowShown(false);
    expect(installs).toHaveLength(2);
    expect(installs.at(-1)?.windowShown).toBe(false);
    c.setWindowShown(true);
    expect(installs.at(-1)?.windowShown).toBe(true);
  });

  it("T087 applying a state to the full menu stays under 2 ms", () => {
    const { c } = controller(fakeMenu(MENU_COMMANDS.map((m) => ({ id: m.id, type: m.type }))));
    const start = performance.now();
    for (let i = 0; i < 100; i++) c.setState({ ...initialCommandState(), busy: i % 2 === 0 });
    expect((performance.now() - start) / 100).toBeLessThan(budget(2));
  });
});

describe("013 contracts/ipc.md the help and confirmation handlers", () => {
  it("app:open-help opens only the two fixed URLs and logs a failure", async () => {
    const opened: string[] = [];
    const warn = vi.fn();
    const h = buildMenuHandlers({
      setMenuState: vi.fn(),
      confirmDeleteForever: () => Promise.resolve(false),
      helpUrls: () => ({ readme: "https://github.com/o/vesta#readme", release: "https://github.com/o/vesta/releases/tag/v1.0.0" }),
      openExternal: (url) => {
        opened.push(url);
        return url.includes("releases") ? Promise.reject(new Error("no browser")) : Promise.resolve();
      },
      log: { warn },
    });
    h.handlers["app:open-help"]?.({ target: "readme" });
    h.handlers["app:open-help"]?.({ target: "release" });
    await Promise.resolve();
    await Promise.resolve();
    expect(opened).toEqual(["https://github.com/o/vesta#readme", "https://github.com/o/vesta/releases/tag/v1.0.0"]);
    expect(warn).toHaveBeenCalledWith("help.open-failed", expect.objectContaining({ kind: "release" }));
  });

  it("FR-018 dialog:confirm-delete-forever returns the user's answer", async () => {
    const ask = vi.fn((title: string) => Promise.resolve(title === "yes"));
    const h = buildMenuHandlers({ setMenuState: vi.fn(), confirmDeleteForever: ask, helpUrls: () => ({ readme: "", release: "" }), openExternal: () => Promise.resolve(), log: { warn: vi.fn() } });
    expect(await h.asyncHandlers["dialog:confirm-delete-forever"]?.({ title: "yes" })).toEqual({ confirmed: true });
    expect(await h.asyncHandlers["dialog:confirm-delete-forever"]?.({ title: "no" })).toEqual({ confirmed: false });
  });
});
