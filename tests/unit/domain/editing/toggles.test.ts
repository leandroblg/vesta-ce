// 011 US1: the toggle decisions (data-model "Outcome table of the toggles"), with no document.
import { describe, expect, it } from "vitest";
import {
  blockAction,
  checklistAction,
  highlightAction,
  indentAction,
  mergeSpan,
  pressed,
  quoteAction,
  type BlockInfo,
  type CharInfo, checklistOff, checklistShortcut } from "../../../../src/domain/editing/toggles";

const p = (over: Partial<BlockInfo> = {}): BlockInfo => ({ kind: "paragraph", list: null, listIndex: null, quoteDepth: 0, ...over });
const bullet = (listIndex = 0) => p({ list: "bullet", listIndex });
const ordered = (listIndex = 0) => p({ list: "ordered", listIndex });
const code = () => p({ kind: "code" });
const ch = (highlight: CharInfo["highlight"]): CharInfo => ({ highlight });

describe("FR-001 Highlight", () => {
  it("FR-001 remove when every character has a highlight, default or color", () => {
    expect(highlightAction([ch("default"), ch("color")])).toBe("remove");
    expect(highlightAction([ch("color")])).toBe("remove");
  });
  it("FR-001 add when some have none", () => {
    expect(highlightAction([ch("default"), ch("none")])).toBe("add");
    expect(highlightAction([ch("none")])).toBe("add");
  });
  it("FR-001 disabled with no text node", () => {
    expect(highlightAction([])).toBe("disabled");
  });
});

describe("FR-002 Code block", () => {
  it("FR-002 every block is code: remove", () => {
    expect(blockAction("codeblock", [code(), code()])).toEqual({ kind: "remove" });
  });
  it("FR-002 partial: each block that is not code becomes its own code block", () => {
    expect(blockAction("codeblock", [code(), p(), p({ kind: "heading" })])).toEqual({ kind: "apply", targets: [1, 2] });
  });
  it("FR-002 none: every block", () => {
    expect(blockAction("codeblock", [p(), p()])).toEqual({ kind: "apply", targets: [0, 1] });
  });
});

describe("FR-002 FR-003 lists", () => {
  it("FR-002 every block's nearest list is the kind: remove", () => {
    expect(blockAction("bullet", [bullet(), bullet()])).toEqual({ kind: "remove" });
    expect(blockAction("ordered", [ordered(), ordered(3)])).toEqual({ kind: "remove" });
  });
  it("FR-003 every block's nearest list is the other kind: switch", () => {
    expect(blockAction("bullet", [ordered(), ordered()])).toEqual({ kind: "switch", targets: [0, 1] });
    expect(blockAction("ordered", [bullet(), bullet(4)])).toEqual({ kind: "switch", targets: [0, 1] });
  });
  it("US1-6 a mix of items and paragraphs, or of both kinds: apply to every block not yet of the kind", () => {
    expect(blockAction("bullet", [bullet(), p(), ordered(2)])).toEqual({ kind: "apply", targets: [1, 2] });
    expect(blockAction("ordered", [p(), p()])).toEqual({ kind: "apply", targets: [0, 1] });
  });
  it("FR-002 a quoted paragraph is still a plain block for lists", () => {
    expect(blockAction("bullet", [p({ quoteDepth: 2 })])).toEqual({ kind: "apply", targets: [0] });
  });
});

describe("FR-002 FR-004 Quote", () => {
  it("FR-004 unquote one level when every block is quoted", () => {
    expect(quoteAction([p({ quoteDepth: 1 }), p({ quoteDepth: 2 })])).toBe("unquote-one");
    expect(blockAction("quote", [p({ quoteDepth: 1 })])).toEqual({ kind: "remove" });
  });
  it("FR-002 partial quotes only the unquoted", () => {
    expect(quoteAction([p({ quoteDepth: 1 }), p()])).toBe("quote-unquoted");
    expect(blockAction("quote", [p({ quoteDepth: 1 }), p(), p()])).toEqual({ kind: "apply", targets: [1, 2] });
  });
});

describe("FR-006 pressed states", () => {
  it("FR-006 Bulleted and Numbered list: every nearest list of the kind; a mix is not pressed", () => {
    expect(pressed("bullet", { blocks: [bullet(), bullet(1)], chars: [] })).toBe(true);
    expect(pressed("bullet", { blocks: [bullet(), ordered()], chars: [] })).toBe(false);
    expect(pressed("ordered", { blocks: [ordered()], chars: [] })).toBe(true);
    expect(pressed("ordered", { blocks: [], chars: [] })).toBe(false);
  });
  it("FR-006 Highlight: every character has some highlight, of any kind", () => {
    expect(pressed("highlight", { blocks: [p()], chars: [ch("default"), ch("color")] })).toBe(true);
    expect(pressed("highlight", { blocks: [p()], chars: [ch("default"), ch("none")] })).toBe(false);
    expect(pressed("highlight", { blocks: [p()], chars: [] })).toBe(false);
  });
  it("FR-006 Quote: every block has at least one level; Code block: every block is code", () => {
    expect(pressed("quote", { blocks: [p({ quoteDepth: 1 }), p({ quoteDepth: 3 })], chars: [] })).toBe(true);
    expect(pressed("quote", { blocks: [p({ quoteDepth: 1 }), p()], chars: [] })).toBe(false);
    expect(pressed("codeblock", { blocks: [code()], chars: [] })).toBe(true);
    expect(pressed("codeblock", { blocks: [code(), p()], chars: [] })).toBe(false);
  });
});

describe("FR-002a merge span", () => {
  it("FR-002a the selected blocks with the code blocks directly above and below", () => {
    expect(mergeSpan(3, true, true)).toEqual({ first: 0, last: 2, withBefore: true, withAfter: true });
    expect(mergeSpan(1, false, true)).toEqual({ first: 0, last: 0, withBefore: false, withAfter: true });
  });
  it("Edge Cases: no code neighbor merges only the selected blocks", () => {
    expect(mergeSpan(2, false, false)).toEqual({ first: 0, last: 1, withBefore: false, withAfter: false });
  });
});

// 012 US3: the Checklist and Indent decisions (FR-006 to FR-012, research §4, §5).
describe("012 FR-010 to FR-012 Checklist", () => {
  const task = (checked: boolean, over: Partial<BlockInfo> = {}) => p({ list: "bullet", listIndex: 0, checked, ...over });
  it("FR-010 paragraphs, or list items without a checkbox: add", () => {
    expect(checklistAction([p(), p()])).toBe("add");
    expect(checklistAction([bullet(), ordered(9)])).toBe("add");
  });
  it("FR-011 every block has a checkbox: remove", () => {
    expect(checklistAction([task(false), task(true)])).toBe("remove");
  });
  it("FR-011 mixed: add", () => {
    expect(checklistAction([task(true), p()])).toBe("add");
  });
  it("FR-012 only headings, code or table cells: disabled", () => {
    expect(checklistAction([p({ kind: "heading" }), code(), p({ inCell: true })])).toBe("disabled");
    expect(checklistAction([])).toBe("disabled");
  });
  it("Edge Cases headings, code and cells beside paragraphs are ignored", () => {
    expect(checklistAction([task(false), p({ kind: "heading" }), code()])).toBe("remove");
  });
  it("FR-012 pressed exactly when every block is a checklist item", () => {
    expect(pressed("check", { blocks: [task(false), task(true)], chars: [] })).toBe(true);
    expect(pressed("check", { blocks: [task(false), p()], chars: [] })).toBe(false);
    expect(pressed("check", { blocks: [], chars: [] })).toBe(false);
  });
});

describe("012 FR-006 to FR-008 Indent", () => {
  const item = (over: Partial<BlockInfo> = {}) => p({ list: "bullet", listIndex: 0, depth: 1, hasPrevSibling: true, ...over });
  it("FR-006 an item with a previous sibling can go deeper", () => {
    expect(indentAction([item({ hasPrevSibling: false }), item()], 1)).toBe("apply");
  });
  it("FR-008 only a first item, outside a list, or a table cell: disabled", () => {
    expect(indentAction([item({ hasPrevSibling: false })], 1)).toBe("disabled");
    expect(indentAction([p()], 1)).toBe("disabled");
    expect(indentAction([item({ inCell: true })], 1)).toBe("disabled");
  });
  it("FR-007 outdent applies to nested items; only top-level items: disabled", () => {
    expect(indentAction([item({ depth: 2 }), item()], -1)).toBe("apply");
    expect(indentAction([item(), item()], -1)).toBe("disabled");
    expect(indentAction([p()], -1)).toBe("disabled");
  });
});

describe("016 the typed checklist shortcut (FR-023, FR-024; PRD Q225, Q240, Q253)", () => {
  const para = { kind: "paragraph", list: null, listIndex: null, quoteDepth: 0 } as const;
  const item = { kind: "paragraph", list: "ordered", listIndex: 0, quoteDepth: 0, checked: null } as const;
  it.each([
    ["a top-level paragraph", { scope: "details", block: para, firstInItem: false }, "wrap"],
    ["a quote's paragraph", { scope: "details", block: { ...para, quoteDepth: 2 }, firstInItem: false }, "wrap"],
    ["a list item's first paragraph", { scope: "details", block: item, firstInItem: true }, "set"],
    ["a checked item's first paragraph", { scope: "details", block: { ...item, checked: true }, firstInItem: true }, "set"],
    ["a list item's later paragraph", { scope: "details", block: item, firstInItem: false }, "none"],
    ["a heading", { scope: "details", block: { ...para, kind: "heading" }, firstInItem: false }, "none"],
    ["a code block", { scope: "details", block: { ...para, kind: "code" }, firstInItem: false }, "none"],
    ["a table cell", { scope: "details", block: { ...para, inCell: true }, firstInItem: false }, "none"],
    ["a title", { scope: "title", block: para, firstInItem: false }, "none"],
    ["a reminder", { scope: "reminder", block: para, firstInItem: false }, "none"],
  ] as const)("%s → %s", (_name, ctx, want) => {
    expect(checklistShortcut(ctx)).toBe(want);
  });
});

describe("016 checklist off (FR-025; PRD Q231)", () => {
  const all = { coversAll: true, nestedInItem: false, prevIsList: false, nextIsList: false };
  it("lifts a whole stand-alone list to paragraphs", () => {
    expect(checklistOff(all)).toBe("lift");
  });
  it.each([
    ["a list directly below", { ...all, nextIsList: true }],
    ["a list directly above", { ...all, prevIsList: true }],
    ["an item left out of the range", { ...all, coversAll: false }],
    ["a list nested in a list item", { ...all, nestedInItem: true }],
  ])("keeps plain items with %s", (_name, list) => {
    expect(checklistOff(list)).toBe("keep");
  });
});
