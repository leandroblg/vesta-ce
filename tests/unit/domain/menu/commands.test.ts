import { describe, expect, it } from "vitest";
import { MENU_COMMANDS, MENUS, commandsIn, isMenuCommandId, menuCommand } from "../../../../src/domain/menu/commands";
import { isActionId } from "../../../../src/domain/shortcuts/actions";
import en from "../../../../src/shared/i18n/locales/en.json";
import { OPTIONS } from "../../../../src/renderer/editor/menu/floating-menu";
import { TABLE_ACTIONS } from "../../../../src/renderer/editor/table-handles";

const keys = en as Record<string, string>;

/** contracts/menu.md, in order: command ids, `role:` items and `-` separators; submenus as `[title]` then their items. */
function layout(isMac: boolean): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const menu of MENUS(isMac)) {
    const items: string[] = [];
    const walk = (entries: (typeof menu)["entries"], prefix: string) => {
      for (const e of entries) {
        if (e.kind === "separator") items.push(`${prefix}-`);
        else if (e.kind === "role") items.push(`${prefix}role:${e.role}`);
        else if (e.kind === "command") items.push(`${prefix}${e.id}`);
        else {
          items.push(`${prefix}[${e.labelKey}]`);
          walk(e.entries, `${prefix}  `);
        }
      }
    };
    walk(menu.entries, "");
    out[menu.id] = items;
  }
  return out;
}

const EDIT = [
  "undo", "redo", "-", "role:cut", "role:copy", "copyLink", "role:paste", "role:selectAll", "-",
  "find", "searchEverything", "matchCase", "exactPhrase", "-",
  "done", "reschedule", "[menuPostponeFor]", "  postponeFor1", "  postponeFor2", "  postponeFor3", "  postponeFor4",
  "alertPeriod", "trash", "-", "restore", "deleteForever",
];
const FORMAT = [
  "fmt:strong", "fmt:emphasis", "fmt:underline", "fmt:strike_through", "fmt:inlineCode", "-",
  "fmt:mark", "fmt:color", "fmt:bg", "-", "fmt:size-up", "fmt:size-down", "-",
  "[menuHeading]", ...[0, 1, 2, 3, 4, 5, 6].map((n) => `  fmt:heading-${String(n)}`), "-",
  "fmt:bullet", "fmt:ordered", "fmt:check", "fmt:indent", "fmt:outdent", "fmt:quote", "fmt:codeblock", "fmt:hr", "-",
  "[menuTable]", "  fmt:table", "  -", "  fmt:row-above", "  fmt:row-below", "  fmt:col-left", "  fmt:col-right", "  -",
  "  fmt:row-delete", "  fmt:col-delete", "  -", "  fmt:table-delete", "-",
  "fmt:link", "fmt:insert",
];
const VIEW = ["view:tasks", "view:archive", "view:trash", "-", "showReminders", "showDetails"];

describe("013 FR-002 to FR-008 the menu command table (contracts/menu.md)", () => {
  it("every id is unique and known", () => {
    const ids = MENU_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(isMenuCommandId(id)).toBe(true);
      expect(menuCommand(id).id).toBe(id);
    }
    expect(isMenuCommandId("nope")).toBe(false);
  });

  it("every label key exists in en.json and every action is a shortcut action", () => {
    for (const c of MENU_COMMANDS) {
      expect(keys[c.labelKey], c.labelKey).toBeTypeOf("string");
      if (c.action !== undefined) expect(isActionId(c.action), c.action).toBe(true);
    }
    for (const isMac of [true, false])
      for (const m of MENUS(isMac)) {
        expect(keys[m.labelKey], m.labelKey).toBeTypeOf("string");
        const walk = (entries: (typeof m)["entries"]) => {
          for (const e of entries) {
            if (e.kind === "role" || e.kind === "submenu") expect(keys[e.labelKey], e.labelKey).toBeTypeOf("string");
            if (e.kind === "submenu") walk(e.entries);
          }
        };
        walk(m.entries);
      }
  });

  it("every fmt: id maps to a floating-menu option or table action, except the menu-only ones", () => {
    const optionIds = new Set<string>([...OPTIONS.map((o) => o.id), ...TABLE_ACTIONS]);
    const menuOnly = /^fmt:(heading-\d|outdent|bg|table)$/;
    for (const c of MENU_COMMANDS) {
      if (!c.id.startsWith("fmt:") || menuOnly.test(c.id)) continue;
      expect(optionIds.has(c.id.slice(4)), c.id).toBe(true);
    }
  });

  it("an ellipsis exactly on the items that open a dialog or window (FR-011)", () => {
    const dots = MENU_COMMANDS.filter((c) => c.ellipsis).map((c) => c.id);
    expect(dots.sort()).toEqual(
      ["settings", "checkUpdates", "export", "import", "alertPeriod", "deleteForever", "fmt:color", "fmt:bg", "fmt:table", "fmt:link", "fmt:insert"].sort(),
    );
    for (const c of MENU_COMMANDS) expect(keys[c.labelKey]?.endsWith("…"), c.id).toBe(c.ellipsis);
  });

  it("macOS: Vesta, File, Edit, Format, View, Window, Help in the contract's order", () => {
    const m = layout(true);
    expect(Object.keys(m)).toEqual(["app", "file", "edit", "format", "view", "window", "help"]);
    expect(m["app"]).toEqual([
      "about", "-", "settings", "checkUpdates", "-", "role:services", "-", "role:hide", "role:hideOthers", "role:unhide", "-", "role:quit",
    ]);
    expect(m["file"]).toEqual(["newTask", "newSub", "newRem", "-", "export", "import", "-", "role:close"]);
    expect(m["edit"]).toEqual(EDIT);
    expect(m["format"]).toEqual(FORMAT);
    expect(m["view"]).toEqual(VIEW);
    expect(m["window"]).toEqual(["minimize", "role:zoom", "-", "showLogs", "-", "role:front"]);
    expect(m["help"]).toEqual(["help", "releaseNotes"]);
  });

  it("Windows and Linux: no Vesta menu; Settings, Check for Updates and Quit in File; About in Help", () => {
    const m = layout(false);
    expect(Object.keys(m)).toEqual(["file", "edit", "format", "view", "window", "help"]);
    expect(m["file"]).toEqual(["newTask", "newSub", "newRem", "-", "export", "import", "-", "settings", "checkUpdates", "-", "role:quit"]);
    expect(m["edit"]).toEqual(EDIT);
    expect(m["format"]).toEqual(FORMAT);
    expect(m["view"]).toEqual(VIEW);
    expect(m["window"]).toEqual(["minimize", "-", "showLogs", "-", "role:close"]);
    expect(m["help"]).toEqual(["help", "releaseNotes", "-", "about"]);
  });

  it("015 FR-010 Postpone For holds the four quick durations, in order, each naming its duration index", () => {
    expect([1, 2, 3, 4].map((n) => menuCommand(`postponeFor${String(n)}` as never).duration)).toEqual([0, 1, 2, 3]);
    expect(menuCommand("reschedule").duration).toBeUndefined();
    expect(keys["menuPostponeFor"]).toBe("Postpone For");
  });

  it("every command appears exactly once per platform", () => {
    for (const isMac of [true, false]) {
      const ids = commandsIn(MENUS(isMac));
      expect(new Set(ids).size, String(isMac)).toBe(ids.length);
      expect(new Set(ids)).toEqual(new Set(MENU_COMMANDS.map((c) => c.id)));
    }
  });
});
