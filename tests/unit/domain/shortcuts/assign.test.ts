import { describe, expect, it } from "vitest";
import { RESERVED_COMBOS, canAssign } from "../../../../src/domain/shortcuts/assign";
import { effectiveMap } from "../../../../src/domain/shortcuts/map";

const LINUX = effectiveMap({}, false);
const MAC = effectiveMap({}, true);

describe("canAssign (007 FR-034, research §9)", () => {
  it("refuses a combination another action holds in an overlapping view", () => {
    expect(canAssign("search", "Mod+N", LINUX, false)).toEqual({ ok: false, reason: "inUse", by: "newTask" });
    expect(canAssign("newTask", "Mod+Z", LINUX, false)).toEqual({ ok: false, reason: "inUse", by: "undo" });
  });

  it("allows sharing when the views do not overlap", () => {
    expect(canAssign("restore", "F2", LINUX, false)).toEqual({ ok: true });
  });

  it("allows Mod+Z once Undo holds another combination, and Mod+Shift+Z by default", () => {
    const map = effectiveMap({ undo: ["Mod+U"] }, false);
    expect(canAssign("newTask", "Mod+Z", map, false)).toEqual({ ok: true });
    expect(canAssign("settings", "Mod+Shift+Z", LINUX, false)).toEqual({ ok: true });
    expect(RESERVED_COMBOS(true)).not.toContain("Mod+Z");
    expect(RESERVED_COMBOS(true)).not.toContain("Mod+Shift+Z");
  });

  it("refuses Tab, the editing keys and the app's menu keys", () => {
    expect(canAssign("newTask", "Tab", LINUX, false)).toMatchObject({ reason: "tab" });
    expect(canAssign("newTask", "Shift+Tab", LINUX, false)).toMatchObject({ reason: "tab" });
    for (const c of ["Mod+A", "Mod+C", "Mod+V", "Mod+X"]) expect(canAssign("newTask", c, LINUX, false)).toMatchObject({ reason: "editing" });
    expect(canAssign("newTask", "Mod+Q", LINUX, false)).toMatchObject({ reason: "app" });
    expect(canAssign("newTask", "Mod+W", LINUX, false)).toMatchObject({ reason: "app" });
    expect(canAssign("newTask", "Mod+H", MAC, true)).toMatchObject({ reason: "app" });
    expect(canAssign("newTask", "Mod+H", LINUX, false)).toEqual({ ok: true });
  });

  it("treats Mod+M as Minimize window's on macOS and as free elsewhere (PRD Q117)", () => {
    expect(canAssign("newTask", "Mod+M", MAC, true)).toEqual({ ok: false, reason: "inUse", by: "minimize" });
    expect(canAssign("newTask", "Mod+M", LINUX, false)).toEqual({ ok: true });
    expect(canAssign("minimize", "Mod+M", LINUX, false)).toEqual({ ok: true });
  });

  it("refuses a printable key without Mod or Alt, for any action", () => {
    for (const c of ["N", "Shift+N", "5", ",", "Space"]) expect(canAssign("done", c, LINUX, false)).toMatchObject({ reason: "printable" });
  });

  it("refuses a global action without Mod unless it is a function key", () => {
    expect(canAssign("newTask", "Alt+N", LINUX, false)).toMatchObject({ reason: "globalNeedsMod" });
    expect(canAssign("newTask", "F", LINUX, false)).toMatchObject({ reason: "printable" });
    expect(canAssign("newTask", "F5", LINUX, false)).toEqual({ ok: true });
  });

  it("allows the other cases of the table", () => {
    expect(canAssign("done", "Alt+N", LINUX, false)).toEqual({ ok: true });
    expect(canAssign("newTask", "Mod+N", LINUX, false)).toEqual({ ok: true });
    const closeMoved = effectiveMap({ close: ["F9"] }, false);
    expect(canAssign("done", "Escape", closeMoved, false)).toEqual({ ok: true });
    expect(canAssign("done", "Escape", LINUX, false)).toEqual({ ok: false, reason: "inUse", by: "close" });
  });

  it("checks refusals in the order tab, editing, app, inUse, printable, globalNeedsMod (analysis A2)", () => {
    // Mod+C is both an editing key and on the reserved list.
    expect(RESERVED_COMBOS(false)).toContain("Mod+C");
    expect(canAssign("newTask", "Mod+C", LINUX, false)).toMatchObject({ reason: "editing" });
  });

  it("refuses something that is not a combination", () => {
    expect(canAssign("newTask", "Mod+", LINUX, false)).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("012 FR-009 the indent keys' conflicts", () => {
  it("FR-009 an editor combo conflicts with a global action and with the other editor action, not with a selection action", () => {
    expect(canAssign("indentItem", "Mod+N", LINUX, false)).toEqual({ ok: false, reason: "inUse", by: "newTask" });
    expect(canAssign("indentItem", "Mod+[", LINUX, false)).toEqual({ ok: false, reason: "inUse", by: "outdentItem" });
    expect(canAssign("indentItem", "Alt+ArrowUp", LINUX, false)).toEqual({ ok: true });
    expect(canAssign("newTask", "Mod+]", LINUX, false)).toEqual({ ok: false, reason: "inUse", by: "indentItem" });
  });
  it("FR-009 Tab cannot be assigned", () => {
    expect(canAssign("indentItem", "Tab", LINUX, false)).toEqual({ ok: false, reason: "tab" });
  });
});

describe("013 the menu's system combinations (contracts/menu.md, FR-014)", () => {
  it("CHK035 Alt+F4 is reserved on Windows and Linux", () => {
    expect(RESERVED_COMBOS(false)).toContain("Alt+F4");
    expect(canAssign("newTask", "Alt+F4", effectiveMap({}, false), false)).toEqual({ ok: false, reason: "app", item: "menuCloseOther" });
    expect(RESERVED_COMBOS(true)).not.toContain("Alt+F4");
  });

  it("FR-014 US2-6 each role's combination is refused naming the menu item that holds it (T109)", () => {
    const mac = { "Mod+Q": "menuQuit", "Mod+W": "menuClose", "Mod+H": "menuHide", "Mod+Alt+H": "menuHideOthers" };
    for (const [combo, item] of Object.entries(mac))
      expect(canAssign("newTask", combo, effectiveMap({}, true), true), combo).toEqual({ ok: false, reason: "app", item });
    const other = { "Mod+Q": "menuQuitOther", "Mod+W": "menuCloseOther", "Alt+F4": "menuCloseOther" };
    for (const [combo, item] of Object.entries(other))
      expect(canAssign("newTask", combo, effectiveMap({}, false), false), combo).toEqual({ ok: false, reason: "app", item });
    const editing = { "Mod+A": "menuSelectAll", "Mod+C": "menuCopy", "Mod+V": "menuPaste", "Mod+X": "menuCut" };
    for (const isMac of [true, false])
      for (const [combo, item] of Object.entries(editing))
        expect(canAssign("newTask", combo, effectiveMap({}, isMac), isMac), combo).toEqual({ ok: false, reason: "editing", item });
  });
});

describe("013 FR-048 the new actions' conflicts", () => {
  it("canAssign refuses Mod+1 for another main-view action, naming Show Tasks", () => {
    expect(canAssign("newTask", "Mod+1", effectiveMap({}, true), true)).toEqual({ ok: false, reason: "inUse", by: "view:tasks" });
  });

  it("a menu command needs Mod, as a global action does; a Format action takes any free combination", () => {
    expect(canAssign("about", "F7", effectiveMap({}, true), true)).toEqual({ ok: true });
    expect(canAssign("about", "Shift+Delete", effectiveMap({}, true), true)).toEqual({ ok: false, reason: "globalNeedsMod" });
    expect(canAssign("fmt:underline", "Ctrl+Alt+U", effectiveMap({}, false), false)).toEqual({ ok: true });
  });
});

describe("013 FR-048 T113 the editor's own keys are not remappable", () => {
  const cases: [string, string][] = [
    ["Mod+B", "fmt:strong"], ["Mod+I", "fmt:emphasis"], ["Mod+E", "fmt:inlineCode"], ["Mod+Alt+X", "fmt:strike_through"],
    ["Mod+Alt+0", "fmt:heading-0"], ["Mod+Alt+3", "fmt:heading-3"], ["Mod+Alt+7", "fmt:ordered"], ["Mod+Alt+8", "fmt:bullet"],
    ["Mod+Shift+B", "fmt:quote"], ["Mod+Alt+C", "fmt:codeblock"],
  ];
  it.each(cases)("%s is refused for any action, naming %s", (combo, by) => {
    for (const isMac of [true, false])
      for (const action of ["newTask", "settings", "done", "underline"] as const) {
        const id = action === "underline" ? "fmt:underline" : action;
        expect(canAssign(id as never, combo, effectiveMap({}, isMac), isMac), `${id} ${combo}`).toEqual({ ok: false, reason: "editor", by });
      }
  });
});
