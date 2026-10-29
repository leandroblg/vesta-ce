// 012 US1: what the floating menu's label names (research §2, contracts/ui.md label table), with no document.
import { describe, expect, it } from "vitest";
import { menuLabel, scopeKind } from "../../../../src/domain/editing/scope";

describe("012 FR-002 scopeKind (innermost first)", () => {
  const cases: [readonly string[], string][] = [
    [["paragraph"], "paragraph"],
    [["heading"], "heading"],
    [["code_block"], "code"],
    [["paragraph", "list_item", "bullet_list"], "listItem"],
    [["paragraph", "list_item", "ordered_list"], "listItem"],
    [["paragraph", "blockquote"], "quote"],
    [["heading", "blockquote"], "quote"],
    [["paragraph", "list_item", "bullet_list", "blockquote"], "listItem"],
    [["paragraph", "blockquote", "list_item", "bullet_list"], "quote"],
    [["paragraph", "table_cell", "table_row", "table"], "cell"],
    [["paragraph", "table_header", "table_row", "table"], "cell"],
    [["code_block", "list_item", "bullet_list"], "code"],
    [["paragraph", "details"], "paragraph"],
    [["paragraph", "footnote_definition"], "paragraph"],
  ];
  it.each(cases)("FR-002 %j → %s", (path, kind) => {
    expect(scopeKind(path)).toBe(kind);
  });
});

describe("012 FR-002 FR-003 menuLabel", () => {
  it("FR-002 details, nothing selected: the kind of the block holding the cursor", () => {
    expect(menuLabel({ empty: true, coversAll: false, path: ["paragraph", "blockquote"] }, "details")).toBe("quote");
  });
  it("FR-002 details, a selection covering all of the details: all", () => {
    expect(menuLabel({ empty: false, coversAll: true, path: ["paragraph"] }, "details")).toBe("all");
  });
  it("FR-002 details, any other selection (one whole block, a selected divider): selection", () => {
    expect(menuLabel({ empty: false, coversAll: false, path: ["paragraph"] }, "details")).toBe("selection");
  });
  it("FR-002 empty details (one empty paragraph) read Paragraph, not All details", () => {
    expect(menuLabel({ empty: true, coversAll: true, path: ["paragraph"] }, "details")).toBe("paragraph");
  });
  it("FR-003 a title or reminder with nothing selected: whole; with a selection: selection", () => {
    for (const scope of ["title", "reminder"] as const) {
      expect(menuLabel({ empty: true, coversAll: false, path: ["paragraph"] }, scope)).toBe("whole");
      expect(menuLabel({ empty: false, coversAll: true, path: ["paragraph"] }, scope)).toBe("selection");
    }
  });
});
