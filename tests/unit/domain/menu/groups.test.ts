// 013 T097 (FR-048, analysis L1): the Settings shortcut table in one style.
import { describe, expect, it } from "vitest";
import { rowLabel, shortcutGroups } from "../../../../src/domain/menu/groups";
import { SHORTCUT_ACTIONS } from "../../../../src/domain/shortcuts/actions";
import en from "../../../../src/shared/i18n/locales/en.json";

const keys = en as Record<string, string>;

describe("013 FR-048 the shortcut table's groups", () => {
  it.each([true, false])("Lists first, then the menus in order, every action exactly once (macOS: %s)", (isMac) => {
    const groups = shortcutGroups(isMac);
    expect(groups.map((g) => g.labelKey)).toEqual(
      isMac
        ? ["scGroupLists", "appName", "menuFile", "menuEdit", "menuFormat", "menuView", "menuWindow", "menuHelp"]
        : ["scGroupLists", "menuFile", "menuEdit", "menuFormat", "menuView", "menuWindow", "menuHelp"],
    );
    const all = groups.flatMap((g) => g.actions);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(SHORTCUT_ACTIONS.map((a) => a.id)));
  });

  it("the Lists group holds the actions with no menu command, in title case in English", () => {
    const lists = shortcutGroups(true)[0]?.actions ?? [];
    expect(lists).toEqual(["up", "down", "edit", "moveUp", "moveDown", "promote", "demote", "collapse", "expand", "close"]);
    expect(lists.map((id) => keys[SHORTCUT_ACTIONS.find((a) => a.id === id)?.labelKey ?? ""])).toEqual([
      "Select Previous", "Select Next", "Edit Title", "Move Item Up", "Move Item Down", "Promote Item", "Demote Item", "Collapse", "Expand", "Close Panel, Cancel Edit or Clear Selection",
    ]);
  });

  it("Show Details is under View, Delete Permanently under Edit, Bold nowhere (typed as markdown)", () => {
    const groups = shortcutGroups(true);
    const of = (id: string) => groups.find((g) => g.actions.includes(id as never))?.labelKey;
    expect(of("open")).toBe("menuView");
    expect(of("deleteForever")).toBe("menuEdit");
    expect(of("fmt:underline")).toBe("menuFormat");
    expect(groups.some((g) => g.actions.includes("fmt:strong"))).toBe(false);
  });

  it("a row reads the menu label without its ellipsis", () => {
    expect(rowLabel("Alert Period…")).toBe("Alert Period");
    expect(rowLabel("Move to Trash")).toBe("Move to Trash");
  });

  it("018 I1: splitting the Archive and Trash shortcut views adds and loses no row: each action once, on both platforms", () => {
    for (const isMac of [true, false]) {
      const rows = shortcutGroups(isMac).flatMap((g) => g.actions);
      expect(new Set(rows).size, String(isMac)).toBe(rows.length);
      expect([...rows].sort(), String(isMac)).toEqual(SHORTCUT_ACTIONS.map((a) => a.id).sort());
    }
  });
});
