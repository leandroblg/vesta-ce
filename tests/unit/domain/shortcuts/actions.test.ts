// 011 FR-022b (PRD Q144): Enter opens details in the Archive and the Trash; Shift+Enter restores.
import { describe, expect, it } from "vitest";
import { SHORTCUT_ACTIONS, actionById, isActionId, viewsOf, viewsOverlap } from "../../../../src/domain/shortcuts/actions";
import { RESERVED_COMBOS, canAssign } from "../../../../src/domain/shortcuts/assign";
import { INPUT_RULE_FORMATS, MENU_COMMANDS } from "../../../../src/domain/menu/commands";
import { actionFor, effectiveMap, normalizeOverrides } from "../../../../src/domain/shortcuts/map";

describe("FR-022b the Archive and Trash keys", () => {
  it("FR-022b restore defaults to Shift+Enter; open acts in the Archive and the Trash too", () => {
    expect(actionById("restore").defaults(false)).toEqual(["Shift+Enter"]);
    expect(actionById("restore").defaults(true)).toEqual(["Shift+Enter"]);
    expect(actionById("open").views).toEqual(["main", "archive", "trash"]);
    const map = effectiveMap({}, false);
    expect(actionFor("Enter", map, "archive")).toBe("open");
    expect(actionFor("Shift+Enter", map, "archive")).toBe("restore");
    expect(actionFor("Enter", map, "main")).toBe("open");
  });

  it("FR-022b a stored restore override of Enter is dropped as a conflict with open", () => {
    const { overrides, issues } = normalizeOverrides({ restore: ["Enter"] }, false);
    expect(overrides.restore).toBeUndefined();
    expect(issues.some((i) => i.action === "restore")).toBe(true);
  });
});

// 012 FR-009 (PRD Q161): indent and outdent list items in the details, remappable.
describe("012 FR-009 the indent keys", () => {
  it("FR-009 indentItem and outdentItem default to Mod+] and Mod+[, act only in the details editor", () => {
    for (const isMac of [false, true]) {
      expect(actionById("indentItem").defaults(isMac)).toEqual(["Mod+]"]);
      expect(actionById("outdentItem").defaults(isMac)).toEqual(["Mod+["]);
    }
    expect(actionById("indentItem")).toMatchObject({ kind: "editor", views: ["editor"], labelKey: "menuIndent" });
    expect(actionById("outdentItem")).toMatchObject({ kind: "editor", views: ["editor"], labelKey: "menuOutdent" });
    const map = effectiveMap({}, false);
    expect(actionFor("Mod+]", map, "editor")).toBe("indentItem");
    expect(actionFor("Mod+]", map, "main")).toBeNull();
    // Global, close and undo actions still act inside the editor.
    expect(actionFor("Mod+N", map, "editor")).toBe("newTask");
    expect(actionFor("Escape", map, "editor")).toBe("close");
    // Selection actions do not.
    expect(actionFor("ArrowUp", map, "editor")).toBeNull();
  });
});

describe("013 FR-048 every menu command is a shortcut action (PRD Q184–Q188)", () => {
  it("FR-048 the views default to Mod+1, Mod+2 and Mod+3", () => {
    for (const isMac of [true, false]) {
      expect(actionById("view:tasks").defaults(isMac)).toEqual(["Mod+1"]);
      expect(actionById("view:archive").defaults(isMac)).toEqual(["Mod+2"]);
      expect(actionById("view:trash").defaults(isMac)).toEqual(["Mod+3"]);
    }
  });

  it("FR-048 Delete Permanently: the distinctive key first, then Delete and Backspace, in the Trash; Move to Trash keeps the main view", () => {
    expect(actionById("deleteForever").defaults(true)).toEqual(["Mod+Alt+Backspace", "Delete", "Backspace"]);
    expect(actionById("deleteForever").defaults(false)).toEqual(["Shift+Delete", "Delete", "Backspace"]);
    expect(actionById("deleteForever").views).toEqual(["trash"]);
    expect(actionById("del").views).toEqual(["main", "archive"]); // 018 FR-009
  });

  it("FR-048 every menu command has an action, except Redo and the Format commands typed as markdown", () => {
    for (const c of MENU_COMMANDS) {
      if (c.id === "redo" || c.id in INPUT_RULE_FORMATS) {
        expect(c.action, c.id).toBeUndefined();
        continue;
      }
      expect(c.action, c.id).toBeDefined();
      if (c.action !== undefined) expect(isActionId(c.action), c.id).toBe(true);
    }
  });

  it("FR-048 the added actions without a default have none; Show Details is the Enter action (PRD Q188)", () => {
    for (const a of SHORTCUT_ACTIONS) {
      if (a.kind !== "command" && a.kind !== "format" && !["reschedule", "postponeFor1", "postponeFor2", "postponeFor3", "postponeFor4", "alertPeriod"].includes(a.id)) continue;
      if (a.id.startsWith("view:") || a.id === "copyLink") continue; // 016: Copy Link has Mod+Shift+C
      expect(a.defaults(true), a.id).toEqual([]);
      expect(a.defaults(false), a.id).toEqual([]);
    }
    expect(MENU_COMMANDS.find((c) => c.id === "showDetails")?.action).toBe("open");
    expect(isActionId("showDetails")).toBe(false);
  });

  it("FR-048 no default collides with another in an overlapping view, or with the menu's reserved combinations", () => {
    for (const isMac of [true, false]) {
      const seen: { id: string; combo: string }[] = [];
      for (const a of SHORTCUT_ACTIONS)
        for (const combo of a.defaults(isMac)) {
          expect(RESERVED_COMBOS(isMac), `${a.id} ${combo}`).not.toContain(combo);
          for (const other of seen.filter((x) => x.combo === combo))
            expect(viewsOverlap(a, actionById(other.id as never)), `${a.id} and ${other.id} on ${combo}`).toBe(false);
          seen.push({ id: a.id, combo });
        }
    }
  });

  it("FR-048 a Format action acts in the editors; a command action everywhere", () => {
    expect(actionById("fmt:underline")).toMatchObject({ kind: "format", views: ["editor"] });
    expect(viewsOf(actionById("view:archive"))).toEqual(["main", "archive", "trash", "editor"]);
  });
});

describe("016 FR-017 the Copy Link action (PRD Q234)", () => {
  it("is a command with Mod+Shift+C by default that acts in an editor too", () => {
    const a = actionById("copyLink");
    expect(a.kind).toBe("command");
    expect(a.defaults(true)).toEqual(["Mod+Shift+C"]);
    expect(a.defaults(false)).toEqual(["Mod+Shift+C"]);
    expect(a.views).toContain("editor");
    expect(a.labelKey).toBe("menuCopyLink");
    expect(MENU_COMMANDS.find((c) => c.id === "copyLink")?.action).toBe("copyLink");
  });
  it.each([true, false])("Mod+Shift+C is free in the default map (isMac %s)", (isMac) => {
    const map = effectiveMap({}, isMac);
    const owners = SHORTCUT_ACTIONS.filter((x) => map[x.id].includes("Mod+Shift+C")).map((x) => x.id);
    expect(owners).toEqual(["copyLink"]);
    expect(actionFor("Mod+Shift+C", map, "editor")).toBe("copyLink");
  });
});

describe("018 FR-009 the Archive and the Trash are separate shortcut views (research §4)", () => {
  it("Delete moves to the Trash in the main view and the Archive, and deletes permanently in the Trash only", () => {
    expect(actionById("del").views).toEqual(["main", "archive"]);
    expect(actionById("deleteForever").views).toEqual(["trash"]);
    for (const id of ["up", "down", "open", "restore", "close"] as const)
      for (const view of ["archive", "trash"] as const) expect(viewsOf(actionById(id)), `${id} ${view}`).toContain(view);
  });

  it("a key may hold Move to Trash and Delete Permanently, which never share a view; not Move to Trash and Restore", () => {
    const map = effectiveMap({}, false);
    expect(canAssign("del", "Shift+Delete", map, false)).toEqual({ ok: true });
    expect(canAssign("del", "Shift+Enter", map, false)).toEqual({ ok: false, reason: "inUse", by: "restore" });
  });
});
