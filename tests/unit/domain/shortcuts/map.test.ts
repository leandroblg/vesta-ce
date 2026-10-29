import { describe, expect, it } from "vitest";
import { actionFor, assign, effectiveMap, normalizeOverrides } from "../../../../src/domain/shortcuts/map";

describe("effectiveMap and actionFor (007 FR-020, FR-033)", () => {
  it("merges overrides over the platform's defaults", () => {
    expect(effectiveMap({}, true).minimize).toEqual(["Mod+M"]);
    expect(effectiveMap({}, false).minimize).toEqual([]);
    const map = effectiveMap({ newTask: ["Mod+Shift+T"] }, false);
    expect(map.newTask).toEqual(["Mod+Shift+T"]);
    expect(map.search).toEqual(["Mod+F"]);
  });

  it("finds the action holding a combination in a view", () => {
    const map = effectiveMap({}, false);
    expect(actionFor("Mod+N", map, "main")).toBe("newTask");
    expect(actionFor("Enter", map, "main")).toBe("open");
    for (const view of ["archive", "trash"] as const) {
      expect(actionFor("Enter", map, view)).toBe("open"); // 011 FR-022b
      expect(actionFor("Shift+Enter", map, view)).toBe("restore");
      expect(actionFor("F2", map, view)).toBeNull();
      expect(actionFor("Mod+F", map, view)).toBe("search");
    }
    // 013 PRD Q187: in the Trash the Delete keys are Delete Permanently, which asks once; 018 FR-009: in the Archive
    // they move the entry to the Trash.
    expect(actionFor("Backspace", map, "trash")).toBe("deleteForever");
    expect(actionFor("Backspace", map, "archive")).toBe("del");
    expect(actionFor("Delete", map, "archive")).toBe("del");
  });
});

describe("assign (FR-033, FR-036)", () => {
  it("replaces all of an action's combinations", () => {
    expect(assign({}, "del", "F8", false)).toEqual({ del: ["F8"] });
  });

  it("removes the override when the combination equals the defaults", () => {
    expect(assign({ newTask: ["F5"] }, "newTask", "Mod+N", false)).toEqual({});
    expect(assign({ minimize: ["Mod+M"] }, "minimize", "Mod+M", true)).toEqual({});
  });
});

describe("normalizeOverrides (FR-038, data-model)", () => {
  it("keeps valid entries", () => {
    expect(normalizeOverrides({ newTask: ["Mod+Shift+T"] }, false)).toEqual({ overrides: { newTask: ["Mod+Shift+T"] }, issues: [] });
  });

  it("drops each damaged entry with one issue and keeps the others", () => {
    const { overrides, issues } = normalizeOverrides(
      {
        nope: ["F5"],
        newTask: [],
        newSub: ["Mod+"],
        newRem: ["F5", "F6", "F7"],
        settings: ["Mod+Shift+T"],
        edit: "F3",
      },
      false,
    );
    expect(overrides).toEqual({ settings: ["Mod+Shift+T"] });
    expect(issues.map((i) => i.action).sort()).toEqual(["edit", "newRem", "newSub", "newTask", "nope"].sort());
  });

  it("drops an override that conflicts with a default or an earlier override", () => {
    expect(normalizeOverrides({ search: ["Mod+N"] }, false).overrides).toEqual({});
    expect(normalizeOverrides({ newTask: ["F5"], search: ["F5"] }, false).overrides).toEqual({ newTask: ["F5"] });
    expect(normalizeOverrides({ restore: ["F2"] }, false).overrides).toEqual({ restore: ["F2"] });
  });

  it("drops a combination the rules refuse", () => {
    expect(normalizeOverrides({ newTask: ["Mod+C"] }, false).overrides).toEqual({});
    expect(normalizeOverrides({ done: ["N"] }, false).overrides).toEqual({});
  });

  it("treats a value that is not an object as empty, with one issue", () => {
    expect(normalizeOverrides(["F5"], false)).toEqual({ overrides: {}, issues: [{ action: null, kind: "unreadable" }] });
    expect(normalizeOverrides(null, false).issues).toHaveLength(1);
  });
});
