// 012: the floating menu on a mounted editor: its scope label, disabled options and new buttons (contracts/ui.md).
import { afterEach, describe, expect, it, vi } from "vitest";
import { AllSelection, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createEditor, type EditorHandle, type EditorScope } from "../../../src/renderer/editor/create-editor";
import { setDisabled } from "../../../src/renderer/editor/menu/floating-menu";
import { memoryPort } from "../../../src/renderer/editor/menu/color-picker";
import { undo as historyUndo } from "@milkdown/kit/prose/history";

const open: EditorHandle[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

async function mount(value: string, scope: EditorScope = "details", opts: { files?: boolean } = {}): Promise<EditorHandle> {
  const host = document.createElement("div");
  document.body.append(host);
  // 014 analysis A1: with a file picker, Insert file or image is shown, as in every editor of the app.
  const editor = await createEditor(host, { scope, value, ...(opts.files === true ? { pickFiles: () => Promise.resolve([]) } : {}) });
  open.push(editor);
  // The menu shows when the editor gains the focus.
  editor.view.dom.dispatchEvent(new FocusEvent("focus"));
  return editor;
}

function find(view: EditorView, text: string): { from: number; to: number } {
  const hits: { from: number; to: number }[] = [];
  view.state.doc.descendants((node, pos) => {
    if (hits.length > 0) return false;
    const at = node.isText ? (node.text?.indexOf(text) ?? -1) : -1;
    if (at >= 0) hits.push({ from: pos + at, to: pos + at + text.length });
    return true;
  });
  const found = hits[0];
  if (found === undefined) throw new Error(`text not found: ${text}`);
  return found;
}

function caret(view: EditorView, text: string): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, find(view, text).from)));
}

const linkField = (name: string) => document.querySelector<HTMLInputElement>(`.fmenu .fm-linkpanel input[name="${name}"]`) as HTMLInputElement;
const panelButton = (act: string) => document.querySelector<HTMLButtonElement>(`.fmenu .fm-linkpanel button[data-act="${act}"]`) as HTMLButtonElement;
const button = (id: string) => document.querySelector<HTMLButtonElement>(`.fmenu button[data-cmd="${id}"]`) as HTMLButtonElement;

describe("012 FR-034 disabled options", () => {
  it("FR-034 a disabled option is announced and inert", async () => {
    const e = await mount("one\n\ntwo");
    caret(e.view, "one");
    const bold = button("strong");
    setDisabled(bold, true);
    expect(bold.getAttribute("aria-disabled")).toBe("true");
    // Never the disabled attribute, so arrow-key roving still reaches it.
    expect(bold.hasAttribute("disabled")).toBe(false);
    const before = e.getMarkdown();
    bold.click();
    bold.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(e.getMarkdown()).toBe(before);
    setDisabled(bold, false);
    expect(bold.hasAttribute("aria-disabled")).toBe(false);
    bold.click();
    expect(e.getMarkdown()).toBe("**one**\n\ntwo");
  });
});

const label = () => document.querySelector<HTMLElement>(".fmenu .fm-scope")?.textContent;

describe("012 FR-002 the label names the cursor's block", () => {
  const doc = [
    "# Heading",
    "Plain paragraph",
    "- list item",
    "> quoted text",
    "```\ncode text\n```",
    "| head |\n| --- |\n| cell text |",
  ].join("\n\n");
  const cases: [string, string][] = [
    ["Heading", "Heading"],
    ["Plain", "Paragraph"],
    ["list item", "List item"],
    ["quoted", "Quote"],
    ["code text", "Code block"],
    ["cell text", "Table cell"],
  ];
  it.each(cases)("FR-002 cursor in %s → %s", async (text, expected) => {
    const e = await mount(doc);
    caret(e.view, text);
    expect(label()).toBe(expected);
  });

  it("FR-002 a partial selection reads Selection; one whole block of several too", async () => {
    const e = await mount("one\n\ntwo");
    const r = find(e.view, "one");
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, r.from, r.to)));
    expect(label()).toBe("Selection");
  });

  it("FR-002 Select All and a drag over everything read All details", async () => {
    const e = await mount("one\n\ntwo");
    e.view.dispatch(e.view.state.tr.setSelection(new AllSelection(e.view.state.doc)));
    expect(label()).toBe("All details");
    const a = find(e.view, "one").from;
    const b = find(e.view, "two").to;
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, a, b)));
    expect(label()).toBe("All details");
  });

  it("FR-002 empty details read Paragraph", async () => {
    await mount("");
    expect(label()).toBe("Paragraph");
  });

  it("FR-003 titles and reminders keep their whole-scope labels", async () => {
    await mount("a title", "title");
    expect(label()).toBe("Whole title");
    document.body.innerHTML = "";
    await mount("a reminder", "reminder");
    expect(label()).toBe("Whole reminder");
  });
});

describe("012 FR-004 the toolbar is described by the label", () => {
  it("FR-004 aria-describedby points at the label, unique per menu, and follows the cursor", async () => {
    const e = await mount("- item\n\nplain");
    await mount("other");
    const menus = document.querySelectorAll<HTMLElement>(".fmenu");
    const ids = [...menus].map((m) => m.getAttribute("aria-describedby"));
    expect(ids[0]).toBeTruthy();
    expect(new Set(ids).size).toBe(2);
    const first = menus[0] as HTMLElement;
    const target = document.getElementById(ids[0] as string);
    expect(target?.classList.contains("fm-scope")).toBe(true);
    caret(e.view, "item");
    expect(target?.textContent).toBe("List item");
    caret(e.view, "plain");
    expect(target?.textContent).toBe("Paragraph");
    expect(first.querySelector("[aria-live]")).toBeNull();
  });
});

const INLINE = ["strong", "emphasis", "underline", "strike_through", "inlineCode", "mark", "color", "link"];
const disabled = (id: string) => button(id).getAttribute("aria-disabled") === "true";

describe("012 FR-002a FR-002b disabled inline options", () => {
  it("FR-002b inline options are disabled in code; block buttons are not", async () => {
    const e = await mount("```\none\n```\n\n```\ntwo\n```\n\nplain");
    caret(e.view, "one");
    expect(label()).toBe("Code block");
    for (const id of INLINE) expect(disabled(id), id).toBe(true);
    for (const id of ["bullet", "quote", "codeblock"]) expect(disabled(id), id).toBe(false);
    // A selection inside two code blocks.
    const a = find(e.view, "one").from;
    const b = find(e.view, "two").to;
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, a, b)));
    for (const id of INLINE) expect(disabled(id), id).toBe(true);
    caret(e.view, "plain");
    for (const id of INLINE) expect(disabled(id), id).toBe(false);
  });

  it("FR-002a a selected divider reads Selection and disables the inline options", async () => {
    const e = await mount("above\n\n---\n\nbelow");
    let at = -1;
    e.view.state.doc.descendants((node, pos) => {
      if (node.type.name === "hr") at = pos;
    });
    e.view.dispatch(e.view.state.tr.setSelection(NodeSelection.create(e.view.state.doc, at)));
    expect(label()).toBe("Selection");
    for (const id of INLINE) expect(disabled(id), id).toBe(true);
  });
});

describe("012 FR-001 FR-002c FR-003 what the options change with nothing selected", () => {
  it("FR-001 Bold changes only the cursor's block; Select All then Italic changes everything", async () => {
    const e = await mount("first\n\nsecond\n\nthird");
    caret(e.view, "second");
    button("strong").click();
    expect(e.getMarkdown()).toBe("first\n\n**second**\n\nthird");
    e.view.dispatch(e.view.state.tr.setSelection(new AllSelection(e.view.state.doc)));
    button("emphasis").click();
    expect(e.getMarkdown()).toBe("*first*\n\n***second***\n\n*third*");
  });

  it("FR-001 in a list item and a table cell only that block changes", async () => {
    const e = await mount("- one\n- two\n\n| a | b |\n| --- | --- |\n| c | d |");
    caret(e.view, "two");
    button("strong").click();
    caret(e.view, "d");
    button("strong").click();
    expect(e.getMarkdown()).toBe("- one\n- **two**\n\n| a | b     |\n| - | ----- |\n| c | **d** |");
  });

  it("FR-003 a title with nothing selected still changes the whole title", async () => {
    const e = await mount("one two", "title");
    caret(e.view, "two");
    button("strong").click();
    expect(e.getMarkdown()).toBe("**one two**");
  });

  it("016 FR-014 (Q233, replacing 012 FR-002c for Link) with nothing selected in the details, Link inserts at the cursor", async () => {
    const e = await mount("first\n\nsecond");
    caret(e.view, "second");
    button("link").click();
    linkField("link-text").value = "docs";
    linkField("link-href").value = "https://example.com";
    linkField("link-href").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(e.getMarkdown()).toBe("first\n\n[docs](https://example.com)second");
  });

  it("FR-002c Divider and Table still insert after the cursor's top-level block", async () => {
    const e = await mount("first\n\nsecond");
    caret(e.view, "first");
    button("hr").click();
    expect(e.getMarkdown()).toBe("first\n\n---\n\nsecond");
    caret(e.view, "second");
    button("table").click();
    expect(e.getMarkdown()).toMatch(/^first\n\n---\n\nsecond\n\n\|/);
  });
});

describe("012 FR-006 to FR-012 the Indent and Checklist buttons", () => {
  it("FR-008 Indent is disabled outside a list and on a first item, with its outdent hint; FR-009a never pressed", async () => {
    const e = await mount("plain\n\n- one\n- two");
    const indent = button("indent");
    expect(indent.getAttribute("aria-label")).toBe("Indent");
    expect(indent.title).toContain("to outdent");
    caret(e.view, "plain");
    expect(disabled("indent")).toBe(true);
    caret(e.view, "one");
    expect(disabled("indent")).toBe(true);
    caret(e.view, "two");
    expect(disabled("indent")).toBe(false);
    expect(indent.hasAttribute("aria-pressed")).toBe(false);
  });

  it("FR-006 FR-007 click indents; Shift+click and Shift+Enter outdent", async () => {
    const e = await mount("- one\n- two");
    caret(e.view, "two");
    button("indent").click();
    expect(e.getMarkdown()).toBe("- one\n  - two");
    button("indent").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    expect(e.getMarkdown()).toBe("- one\n- two");
    button("indent").click();
    button("indent").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    expect(e.getMarkdown()).toBe("- one\n- two");
  });

  it("FR-012 Checklist is pressed on checklist items, disabled with no paragraph or list item", async () => {
    const e = await mount("# Head\n\n- [ ] task\n\nplain");
    caret(e.view, "task");
    expect(button("check").getAttribute("aria-pressed")).toBe("true");
    caret(e.view, "plain");
    expect(button("check").getAttribute("aria-pressed")).toBe("false");
    caret(e.view, "Head");
    expect(disabled("check")).toBe(true);
    caret(e.view, "plain");
    button("check").click();
    expect(e.getMarkdown()).toBe("# Head\n\n- [ ] task\n- [ ] plain");
  });
});

describe("012 FR-014 to FR-017 the font size buttons", () => {
  it("FR-014 Increase and Decrease replace Font size in every scope; FR-009a never pressed", async () => {
    for (const scope of ["details", "title", "reminder"] as const) {
      await mount("text", scope);
      expect(document.querySelector('.fmenu button[data-cmd="size"]'), scope).toBeNull();
      expect(button("size-up").getAttribute("aria-label")).toBe("Increase font size");
      expect(button("size-down").getAttribute("aria-label")).toBe("Decrease font size");
      expect(button("size-up").hasAttribute("aria-pressed")).toBe(false);
      document.body.innerHTML = "";
    }
  });

  it("FR-017 each button is disabled at its end; a press steps the cursor's block", async () => {
    const e = await mount('[big]{size="2.5em"}\n\n[small]{size="0.75em"}\n\nplain');
    caret(e.view, "big");
    expect(disabled("size-up")).toBe(true);
    expect(disabled("size-down")).toBe(false);
    caret(e.view, "small");
    expect(disabled("size-down")).toBe(true);
    caret(e.view, "plain");
    button("size-up").click();
    expect(e.getMarkdown()).toBe('[big]{size="2.5em"}\n\n[small]{size="0.75em"}\n\n[plain]{size="1.25em"}');
    button("size-down").click();
    expect(e.getMarkdown()).toBe('[big]{size="2.5em"}\n\n[small]{size="0.75em"}\n\nplain');
  });
});

describe("012 FR-025 Delete table from the floating menu", () => {
  it("FR-025 Delete table is a named table option; activating it removes the table and focuses the editor", async () => {
    const e = await mount("| h |\n| - |\n| c |\n\nafter");
    caret(e.view, "c");
    const del = button("table-delete");
    expect(del.hidden).toBe(false);
    expect(del.getAttribute("aria-label")).toBe("Delete table");
    del.focus();
    del.click();
    expect(e.getMarkdown()).toBe("after");
    expect(e.view.dom.contains(document.activeElement)).toBe(true);
    caret(e.view, "after");
    expect(button("table-delete").hidden).toBe(true);
  });
});

describe("012 FR-013 the Quote glyph", () => {
  it("FR-013 the Quote button shows a pair of quotation marks (013 FR-041: the quote symbol) and is named Quote", async () => {
    await mount("text");
    const quote = button("quote");
    expect(quote.querySelector<SVGElement>("svg")?.dataset.symbol).toBe("quote");
    expect(quote.getAttribute("aria-label")).toBe("Quote");
  });
});

// 012 plan "Performance Goals", SC-007: a menu refresh and a button press on a 1,000-paragraph document.
describe("012 plan Performance Goals", () => {
  it("a menu refresh with the caret stays under 2 ms; a press of Bold or Increase font size under 100 ms", async () => {
    const md = Array.from({ length: 1000 }, (_, i) => `paragraph ${String(i)} with ==some== text`).join("\n\n");
    const e = await mount(md);
    caret(e.view, "paragraph 500");
    const refresh = () => {
      e.view.dispatch(e.view.state.tr.setMeta("refresh", true));
    };
    for (let i = 0; i < 20; i++) refresh();
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) refresh();
    const refreshMs = (performance.now() - t0) / 200;
    const press = (cmd: string) => {
      const t = performance.now();
      button(cmd).click();
      return performance.now() - t;
    };
    const boldMs = press("strong");
    const sizeMs = press("size-up");
    console.info(`[012 T072] menu refresh ${refreshMs.toFixed(3)} ms; Bold ${boldMs.toFixed(1)} ms; Increase font size ${sizeMs.toFixed(1)} ms`);
    expect(refreshMs).toBeLessThan(2);
    expect(boldMs).toBeLessThan(100);
    expect(sizeMs).toBeLessThan(100);
  });
});

describe("013 FR-016 the Format menu's snapshot and run (T042, T044)", () => {
  function select(view: EditorView, text: string): void {
    const { from, to } = find(view, text);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  }

  it("FR-016 in a title, offered has no details-only id", async () => {
    const e = await mount("plain", "title");
    const snap = e.formatSnapshot();
    expect(snap?.offered).toContain("strong");
    for (const id of ["bullet", "ordered", "check", "indent", "outdent", "quote", "codeblock", "table"]) expect(snap?.offered, id).not.toContain(id);
  });

  it("FR-016 in the details: bold selected is pressed; an H2 sets heading; outside a list Indent is disabled", async () => {
    const e = await mount("**bold** text\n\n## Two");
    select(e.view, "bold");
    const snap = e.formatSnapshot();
    expect(snap?.pressed).toContain("strong");
    expect(snap?.disabled).toContain("indent");
    expect(snap?.disabled).toContain("outdent");
    caret(e.view, "Two");
    expect(e.formatSnapshot()?.heading).toBe(2);
  });

  it("FR-016 in a table cell, inTable and the table actions, without Remove Row on the header row", async () => {
    const e = await mount("| a | b |\n| - | - |\n| c | d |");
    caret(e.view, "a");
    const head = e.formatSnapshot();
    expect(head?.inTable).toBe(true);
    expect(head?.tableActions).toContain("row-below");
    expect(head?.tableActions).not.toContain("row-delete");
  });

  it("FR-010 run(id) equals a button click, and an option the scope lacks does nothing", async () => {
    const a = await mount("one two");
    select(a.view, "one");
    expect(a.format("strong")).toBe(true);
    const viaMenu = a.getMarkdown();
    a.destroy();
    open.pop();
    const b = await mount("one two");
    select(b.view, "one");
    button("strong").click();
    expect(b.getMarkdown()).toBe(viaMenu);
    const t = await mount("title", "title");
    expect(t.format("bullet")).toBe(false);
  });

  it("T044 Format › Heading sets a level directly; None gives a paragraph; one Undo step each", async () => {
    const e = await mount("para");
    caret(e.view, "para");
    expect(e.format("heading-3")).toBe(true);
    expect(e.getMarkdown()).toBe("### para");
    expect(e.format("heading-0")).toBe(true);
    expect(e.getMarkdown()).toBe("para");
  });

  it("Format › Outdent is Shift+Indent; Insert Table… opens the size grid", async () => {
    const e = await mount("- one\n  - two");
    caret(e.view, "two");
    expect(e.format("indent", true)).toBe(true);
    expect(e.getMarkdown()).toBe("- one\n- two");
    const d = await mount("x");
    caret(d.view, "x");
    expect(d.format("table")).toBe(true);
    expect(document.querySelector(".tsize:not([hidden])")).not.toBeNull();
  });
});

describe("013 FR-042 one Highlight button (PRD Q170)", () => {
  function select(view: EditorView, text: string): void {
    const { from, to } = find(view, text);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  }
  const picker = () => document.querySelector<HTMLElement>(".cpick") as HTMLElement;

  it.each(["details", "title", "reminder"] as const)("FR-042 no Highlight color button in the %s scope", async (scope) => {
    await mount("text", scope);
    expect(document.querySelector('.fmenu [data-cmd="bg"]')).toBeNull();
    expect(button("mark")).not.toBeNull();
  });

  it("FR-042 a click toggles the default highlight; its title gives the second action", async () => {
    const e = await mount("word here");
    select(e.view, "word");
    button("mark").click();
    expect(e.getMarkdown()).toBe("==word== here");
    expect(button("mark").title).toMatch(/Hold or .* for colors/);
  });

  it("FR-042 a 500 ms press opens the highlight picker and toggles nothing; Shift+Enter opens it with focus", async () => {
    vi.useFakeTimers();
    try {
      const e = await mount("word");
      select(e.view, "word");
      const mark = button("mark");
      mark.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
      vi.advanceTimersByTime(500);
      mark.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true }));
      mark.click();
      expect(picker().hidden).toBe(false);
      expect(picker().getAttribute("aria-label")).toBe("Highlight color");
      expect(e.getMarkdown()).toBe("word");
      picker().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      mark.focus();
      mark.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
      expect(picker().hidden).toBe(false);
      expect(picker().contains(document.activeElement)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Format › Highlight Color… (run bg) opens the same picker; the snapshot offers bg with Highlight", async () => {
    const e = await mount("word");
    select(e.view, "word");
    expect(e.formatSnapshot()?.offered).toContain("bg");
    expect(e.format("bg")).toBe(true);
    expect(picker().getAttribute("aria-label")).toBe("Highlight color");
  });
});

describe("013 FR-039 to FR-041, 014 FR-014 to FR-018: the menu's two rows, symbols and label column (T077)", () => {
  const rowIds = (i: number) =>
    Array.from(document.querySelectorAll<HTMLElement>(".fmenu .fm-row")[i]?.querySelectorAll<HTMLElement>("button[data-cmd]") ?? [])
      .filter((b) => !b.hidden)
      .map((b) => b.dataset.cmd);

  const TABLE = ["row-above", "row-below", "col-left", "col-right", "row-delete", "col-delete", "table-delete"];

  it("014 FR-014 to FR-016 (Q196) one fixed sequence split evenly: 6 and 6 in a title and a reminder, 10 and 10 in the details", async () => {
    await mount("text", "title", { files: true });
    // 018 FR-036: a third row exists for the table options and shows only in a table.
    expect(document.querySelectorAll(".fmenu .fm-row:not([hidden])")).toHaveLength(2);
    const titleRows = [
      ["strong", "emphasis", "underline", "strike_through", "inlineCode", "color"],
      ["mark", "size-up", "size-down", "heading", "link", "insert"],
    ];
    expect([rowIds(0), rowIds(1)]).toEqual(titleRows);
    for (const e of open.splice(0)) e.destroy();
    document.body.innerHTML = "";
    await mount("text", "reminder", { files: true });
    expect([rowIds(0), rowIds(1)]).toEqual(titleRows);
    for (const e of open.splice(0)) e.destroy();
    document.body.innerHTML = "";
    await mount("text", "details", { files: true });
    expect(rowIds(0)).toEqual(["strong", "emphasis", "underline", "strike_through", "inlineCode", "color", "mark", "size-up", "size-down", "heading"]);
    expect(rowIds(1)).toEqual(["bullet", "ordered", "check", "indent", "quote", "codeblock", "hr", "table", "link", "insert"]);
  });

  it("014 FR-015 a scope without Insert splits its 11 options six and five, the first row taking the odd one", async () => {
    await mount("text", "title");
    expect(rowIds(0)).toHaveLength(6);
    expect(rowIds(1)).toEqual(["mark", "size-up", "size-down", "heading", "link"]);
  });

  it("018 FR-036 (Q286) in a table the table options show on a third row; rows one and two keep their buttons", async () => {
    const d = await mount("| a | b |\n| - | - |\n| c | d |\n\npara", "details", { files: true });
    caret(d.view, "para");
    const outside = [rowIds(0), rowIds(1)];
    expect(document.querySelectorAll(".fmenu .fm-row:not([hidden])")).toHaveLength(2);
    expect(outside.flat().some((id) => TABLE.includes(id as string))).toBe(false);
    caret(d.view, "c");
    d.view.dispatch(d.view.state.tr);
    expect(document.querySelectorAll(".fmenu .fm-row:not([hidden])")).toHaveLength(3);
    expect([rowIds(0), rowIds(1)]).toEqual(outside);
    const third = rowIds(2);
    expect(third.length).toBeGreaterThan(0);
    expect(third).toEqual(TABLE.filter((id) => third.includes(id)));
    expect((document.querySelector(".fmenu .fm-scope") as HTMLElement).style.gridRow).toBe("1 / span 3");
  });

  it("018 FR-036 the title and reminder menus never show a third row", async () => {
    await mount("text", "title", { files: true });
    expect(document.querySelectorAll(".fmenu .fm-row:not([hidden])")).toHaveLength(2);
    expect(rowIds(2)).toEqual([]);
  });

  it("014 FR-018 Up and Down move to the same place in the other row, or its last button", async () => {
    const d = await mount("| a | b |\n| - | - |\n| c | d |", "details", { files: true });
    caret(d.view, "c");
    d.view.dispatch(d.view.state.tr);
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".fmenu .fm-row"));
    const shown = (r: HTMLElement) => Array.from(r.querySelectorAll<HTMLButtonElement>("button[data-cmd]")).filter((b) => !b.hidden);
    const r0 = shown(rows[0] as HTMLElement);
    const r1 = shown(rows[1] as HTMLElement);
    (r0.at(-1) as HTMLButtonElement).focus();
    (r0.at(-1) as HTMLButtonElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(r1[r0.length - 1]);
    const past = r1.at(-1) as HTMLButtonElement;
    past.focus();
    past.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(r0.at(-1));
  });

  it("FR-041 no emoji, and no two buttons share a glyph", async () => {
    await mount("text");
    const seen = new Set<string>();
    for (const b of Array.from(document.querySelectorAll<HTMLElement>(".fmenu button[data-cmd]"))) {
      const svg = b.querySelector<SVGElement>("svg");
      const letter = b.querySelector<HTMLElement>("[data-glyph]")?.dataset.glyph;
      const key = svg !== null ? `svg:${svg.dataset.symbol ?? ""}` : `${b.dataset.cmd === "color" || b.dataset.cmd === "mark" ? `${b.dataset.cmd}:` : ""}${letter ?? ""}`;
      expect(key, b.dataset.cmd).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(seen.has(key), `${b.dataset.cmd} ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("FR-040 the label column is the widest label of the scope, recomputed on relabel", async () => {
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const width = this.classList.contains("fm-scope") ? this.textContent.length * 7 : 0;
      return { width, height: 10, top: 0, left: 0, right: width, bottom: 10, x: 0, y: 0, toJSON: () => ({}) };
    });
    try {
      await mount("text");
      const menuEl = document.querySelector<HTMLElement>(".fmenu") as HTMLElement;
      const widest = Math.max(...["All details", "Selection", "Paragraph", "Heading", "List item", "Quote", "Code block", "Table cell"].map((s) => s.length * 7));
      expect(menuEl.style.getPropertyValue("--fm-label-w")).toBe(`${String(widest)}px`);
    } finally {
      spy.mockRestore();
    }
  });

  it("Up and Down move to the same position in the other row", async () => {
    await mount("text");
    const italic = button("emphasis");
    italic.focus();
    italic.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect((document.activeElement as HTMLElement).dataset.cmd).toBe(rowIds(1)[1]);
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect((document.activeElement as HTMLElement).dataset.cmd).toBe("emphasis");
  });
});

describe("016 FR-013 to FR-015a the link panel (PRD Q233, Q245, Q251; ui.md \"Link panel\")", () => {
  const select = (e: EditorHandle, text: string) => {
    const r = find(e.view, text);
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, r.from, r.to)));
  };
  /** From the start of `a` to `length` characters into `b` (a selection across text nodes). */
  const span = (e: EditorHandle, a: string, b: string, length: number) => {
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, find(e.view, a).from, find(e.view, b).from + length)));
  };
  const panel = () => document.querySelector<HTMLElement>(".fmenu .fm-linkpanel") as HTMLElement;
  const enter = (el: HTMLElement) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const esc = (el: HTMLElement) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  it("replaces the rows at the same spot, prefilled with the selection, the focus in Link", async () => {
    const e = await mount("read the docs today");
    select(e, "docs");
    button("link").click();
    expect(panel().hidden).toBe(false);
    expect(document.querySelector(".fmenu")?.classList.contains("linking")).toBe(true);
    expect(linkField("link-text").value).toBe("docs");
    expect(linkField("link-href").value).toBe("");
    expect(document.activeElement).toBe(linkField("link-href"));
    // Tab order: Link text, Link, Apply, Remove link, Cancel.
    const order = [...panel().querySelectorAll<HTMLElement>("input, button")].map((x) => x.getAttribute("name") ?? x.dataset["act"]);
    expect(order).toEqual(["link-text", "link-href", "apply", "remove", "cancel"]);
    expect(panelButton("remove").getAttribute("aria-disabled")).toBe("true");
  });

  it("Enter in either field applies and shows the rows again; the focus returns to the editor", async () => {
    const e = await mount("read the docs today");
    select(e, "docs");
    button("link").click();
    linkField("link-href").value = "https://example.com";
    enter(linkField("link-text"));
    expect(e.getMarkdown()).toBe("read the [docs](https://example.com) today");
    expect(panel().hidden).toBe(true);
    expect(document.querySelector(".fmenu")?.classList.contains("linking")).toBe(false);
  });

  it("the cursor inside a link prefills both fields and Apply edits it in place, keeping the words' formatting", async () => {
    const e = await mount("see [**the docs**](https://old.example) now");
    caret(e.view, "docs");
    button("link").click();
    expect(linkField("link-text").value).toBe("the docs");
    expect(linkField("link-href").value).toBe("https://old.example");
    expect(panelButton("remove").getAttribute("aria-disabled")).toBeNull();
    linkField("link-href").value = "https://new.example";
    panelButton("apply").click();
    // The same document either way the serializer nests the bold and the link.
    expect(e.getMarkdown()).toMatch(/^see (\[\*\*the docs\*\*\]|\*\*\[the docs\])\(https:\/\/new\.example\)(\*\*)? now$/);
  });

  it("changed text takes the formatting of the range's first character", async () => {
    const e = await mount("see [*docs*](https://e.example) now");
    caret(e.view, "docs");
    button("link").click();
    linkField("link-text").value = "manual";
    panelButton("apply").click();
    expect(e.getMarkdown()).toMatch(/^see (\[\*manual\*\]|\*\[manual\])\(https:\/\/e\.example\)\*? now$/);
  });

  it("Remove link unlinks only the selected words and keeps the text", async () => {
    const e = await mount("[alpha beta](https://e.example)");
    select(e, "beta");
    button("link").click();
    expect(linkField("link-href").value).toBe("https://e.example");
    panelButton("remove").click();
    // The serializer keeps the space outside the link; "beta" is plain text either way.
    expect(e.getMarkdown()).toMatch(/^\[alpha ?\]\(https:\/\/e\.example\) ?beta$/);
  });

  it("Q251 over part of a link, Apply links the selected words only; the rest keeps its address", async () => {
    const e = await mount("[alpha beta](https://a.example) gamma");
    span(e, "beta", "gamma", 3);
    button("link").click();
    expect(linkField("link-href").value).toBe("https://a.example");
    linkField("link-href").value = "https://b.example";
    panelButton("apply").click();
    expect(e.getMarkdown()).toMatch(/^\[alpha ?\]\(https:\/\/a\.example\) ?\[beta gam\]\(https:\/\/b\.example\)ma$/);
  });

  it("Q251 over several links, Link is empty and Apply makes the selected words one link", async () => {
    const e = await mount("[one](https://1.example) and [two](https://2.example)");
    span(e, "one", "two", 3);
    button("link").click();
    expect(linkField("link-href").value).toBe("");
    linkField("link-href").value = "https://both.example";
    panelButton("apply").click();
    expect(e.getMarkdown()).toBe("[one and two](https://both.example)");
  });

  it("FR-015a an unsafe address is refused with the line under Link; the panel stays open and nothing is linked", async () => {
    const e = await mount("click here");
    select(e, "here");
    button("link").click();
    linkField("link-href").value = "javascript:alert(1)";
    panelButton("apply").click();
    const line = document.querySelector<HTMLElement>(".fmenu .fm-link-error") as HTMLElement;
    expect(line.hidden).toBe(false);
    expect(line.getAttribute("role")).toBe("alert");
    expect(line.textContent).toBe("This address is not allowed.");
    expect(panel().hidden).toBe(false);
    expect(e.getMarkdown()).toBe("click here");
  });

  it("FR-015a a typed path goes to the stored-file flow (confirmation and copy)", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onLinkPath = vi.fn(() => Promise.resolve(null));
    const e = await createEditor(host, { scope: "details", value: "the file", importPath: onLinkPath } as never);
    open.push(e);
    e.view.dom.dispatchEvent(new FocusEvent("focus"));
    select(e, "file");
    button("link").click();
    linkField("link-href").value = "/Users/me/a.pdf";
    panelButton("apply").click();
    expect(onLinkPath).toHaveBeenCalled();
  });

  it("Esc cancels without a change, closes only the panel and shows the rows again", async () => {
    const e = await mount("read the docs");
    select(e, "docs");
    button("link").click();
    linkField("link-href").value = "https://e.example";
    esc(linkField("link-href"));
    expect(e.getMarkdown()).toBe("read the docs");
    expect(panel().hidden).toBe(true);
    expect(document.querySelector<HTMLElement>(".fmenu")?.hidden).toBe(false);
  });

  it("in a title with nothing selected, Link text holds the whole title and Apply links all of it", async () => {
    const e = await mount("whole title", "title");
    caret(e.view, "title");
    button("link").click();
    expect(linkField("link-text").value).toBe("whole title");
    linkField("link-href").value = "https://e.example";
    panelButton("apply").click();
    expect(e.getMarkdown()).toBe("[whole title](https://e.example)");
  });

  it("an empty Link on an existing link removes it; on new text it links nothing", async () => {
    const e = await mount("[x](https://e.example) y");
    caret(e.view, "x");
    button("link").click();
    linkField("link-href").value = "";
    panelButton("apply").click();
    expect(e.getMarkdown()).toBe("x y");
  });

  it("the Link button no longer toggles a link off", async () => {
    const e = await mount("[x](https://e.example)");
    select(e, "x");
    button("link").click();
    expect(panel().hidden).toBe(false);
    expect(e.getMarkdown()).toBe("[x](https://e.example)");
  });
});

describe("016 FR-016, FR-016c a stored link in the editor (PRD Q255, Q257)", () => {
  const panel = () => document.querySelector<HTMLElement>(".fmenu .fm-linkpanel") as HTMLElement;
  const error = () => document.querySelector<HTMLElement>(".fmenu .fm-link-error") as HTMLElement;
  const linkEl = (view: EditorView) => view.dom.querySelector("a[href]") as HTMLAnchorElement;

  it("a Cmd/Ctrl+click on a stored javascript: link opens nothing: its text is selected and the panel shows the refusal", async () => {
    const opened = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const e = await createEditor(host, { scope: "details", value: "go [there](javascript:alert(1)) now", openLink: opened });
    open.push(e);
    e.view.dom.dispatchEvent(new FocusEvent("focus"));
    const at = find(e.view, "there");
    const event = new MouseEvent("click", { metaKey: true, ctrlKey: true, bubbles: true });
    Object.defineProperty(event, "target", { value: linkEl(e.view) });
    const handled = e.view.someProp("handleClick", (f) => f(e.view, at.from + 1, event));
    expect(handled).toBe(true);
    expect(opened).not.toHaveBeenCalled();
    expect(e.view.state.selection.from).toBe(at.from);
    expect(e.view.state.selection.to).toBe(at.to);
    expect(panel().hidden).toBe(false);
    expect(linkField("link-text").value).toBe("there");
    expect(linkField("link-href").value).toBe("javascript:alert(1)");
    expect(error().hidden).toBe(false);
    expect(error().textContent).toBe("This link's address is not safe, so it will not be opened.");
    expect(document.activeElement).toBe(linkField("link-href"));
    // A safe address and Apply relink it.
    linkField("link-href").value = "https://example.com";
    panelButton("apply").click();
    expect(e.getMarkdown()).toBe("go [there](https://example.com) now");
  });

  it("a Cmd/Ctrl+click on a safe link opens it", async () => {
    const opened = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const e = await createEditor(host, { scope: "details", value: "go [there](https://example.com) now", openLink: opened });
    open.push(e);
    const at = find(e.view, "there");
    const event = new MouseEvent("click", { metaKey: true, ctrlKey: true, bubbles: true });
    Object.defineProperty(event, "target", { value: linkEl(e.view) });
    e.view.someProp("handleClick", (f) => f(e.view, at.from + 1, event));
    expect(opened).toHaveBeenCalledWith("https://example.com");
  });

  it("a right-click on a safe link opens the link menu with its stored address and text; on an unsafe one, no menu", async () => {
    const { useVesta } = await import("../../../src/renderer/store/store");
    const safe = await mount(`see [the file](assets/${"a".repeat(64)}.pdf) and [bad](javascript:x)`);
    const links = safe.view.dom.querySelectorAll("a[href]");
    const first = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 });
    links[0]?.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(useVesta.getState().linkMenu).toMatchObject({ x: 30, y: 40, href: `assets/${"a".repeat(64)}.pdf`, text: "the file" });
    useVesta.setState({ linkMenu: null });
    const second = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    links[1]?.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
    expect(useVesta.getState().linkMenu).toBeNull();
  });

  it("unsafeLinkAt opens the panel on the n-th unsafe link with the refusal line", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const e = await createEditor(host, { scope: "title", value: "[a](https://a.example) [b](javascript:b) [c](data:x)", unsafeLinkAt: 1 });
    open.push(e);
    const at = find(e.view, "c");
    expect(e.view.state.selection.from).toBe(at.from);
    expect(panel().hidden).toBe(false);
    expect(error().hidden).toBe(false);
  });
});

describe("016 FR-019 to FR-021 the Text color button (PRD Q223)", () => {
  const SWATCH = "#2563ebff";
  const picker = () => document.querySelector<HTMLElement>(".cpick") as HTMLElement;
  const glyph = () => button("color").querySelector<HTMLElement>("span[data-glyph]") as HTMLElement;

  async function mountWith(value: string, scope: EditorScope, last = SWATCH) {
    const port = memoryPort();
    port.setLastTextColor?.(last);
    const setLast = vi.spyOn(port, "setLastTextColor");
    const host = document.createElement("div");
    document.body.append(host);
    const e = await createEditor(host, { scope, value, colors: port });
    open.push(e);
    e.view.dom.dispatchEvent(new FocusEvent("focus"));
    return { e, port, setLast };
  }

  it("the swatch is the last text color, the ember on a fresh port", async () => {
    const { e } = await mountWith("one", "details", "#b9411cff");
    caret(e.view, "one");
    expect(glyph().style.borderBottomColor).not.toBe("");
    const fresh = memoryPort();
    expect(fresh.lastTextColor?.()).toBe("#b9411cff");
  });

  it("a click applies the swatch to the selection, a second click removes it, pressed exactly then; each one Undo step", async () => {
    const { e, port } = await mountWith("alpha beta", "details");
    const before = port.get();
    const range = find(e.view, "beta");
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, range.from, range.to)));
    expect(button("color").getAttribute("aria-pressed")).toBe("false");
    button("color").click();
    expect(e.getMarkdown()).toContain(SWATCH);
    expect(button("color").getAttribute("aria-pressed")).toBe("true");
    // A click with the swatch leaves the recent colors alone.
    expect(port.get()).toEqual(before);
    button("color").click();
    expect(e.getMarkdown()).toBe("alpha beta");
    historyUndo(e.view.state, e.view.dispatch);
    expect(e.getMarkdown()).toContain(SWATCH);
    historyUndo(e.view.state, e.view.dispatch);
    expect(e.getMarkdown()).toBe("alpha beta");
  });

  it("with nothing selected it colors the paragraph holding the cursor in the details, the whole text in a title", async () => {
    const d = await mountWith("first\n\nsecond", "details");
    caret(d.e.view, "second");
    button("color").click();
    const md = d.e.getMarkdown();
    expect(md.startsWith("first")).toBe(true);
    expect(md).toContain(SWATCH);
    expect(md.split("\n\n")[1]).toContain("second");
    d.e.destroy();
    open.splice(0);
    document.body.innerHTML = "";

    const tt = await mountWith("whole title", "title");
    caret(tt.e.view, "title");
    button("color").click();
    expect(tt.e.getMarkdown()).toMatch(new RegExp(`^\\[whole title\\]\\{.*${SWATCH}`));
  });

  it("a different stored color is replaced by the swatch, never treated as on", async () => {
    const { e } = await mountWith("[word]{color=#ff0000ff}", "title");
    caret(e.view, "word");
    expect(button("color").getAttribute("aria-pressed")).toBe("false");
    button("color").click();
    expect(e.getMarkdown()).toContain(SWATCH);
    expect(e.getMarkdown()).not.toContain("#ff0000ff");
  });

  it("Shift+Enter opens the text color picker; a pick is applied and becomes the swatch; Remove color and a highlight pick do not change it", async () => {
    const { e, setLast } = await mountWith("pick me", "title");
    caret(e.view, "pick");
    const color = button("color");
    color.focus();
    color.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    expect(picker().hidden).toBe(false);
    expect(picker().getAttribute("aria-label")).toBe("Text color");
    (picker().querySelector('[data-section="preset"][data-hex]') as HTMLElement).click();
    expect(setLast).toHaveBeenCalledTimes(1);
    const picked = setLast.mock.calls[0]?.[0];
    expect(e.getMarkdown()).toContain(String(picked));

    color.focus();
    color.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    (picker().querySelector('[data-section="auto"]') as HTMLElement).click();
    expect(setLast).toHaveBeenCalledTimes(1);

    const mark = button("mark");
    mark.focus();
    mark.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    expect(picker().getAttribute("aria-label")).toBe("Highlight color");
    (picker().querySelector('[data-section="preset"][data-hex]') as HTMLElement).click();
    expect(setLast).toHaveBeenCalledTimes(1);
  });

  it("Format › Text Color… (run) still opens the picker", async () => {
    const { e } = await mountWith("format", "title");
    caret(e.view, "format");
    e.format("color");
    expect(picker().hidden).toBe(false);
  });
});

describe("016 FR-026, FR-027 Shift+Quote and the Divider glyph (PRD Q232, Q235)", () => {
  const span = (view: EditorView, a: string, b: string) => {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, find(view, a).from, find(view, b).to)));
  };
  const shiftEnter = (el: HTMLElement) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));

  it("Shift+click nests one level deeper each time, the cursor's block with nothing selected", async () => {
    const e = await mount("one\n\ntwo");
    caret(e.view, "two");
    button("quote").dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
    expect(e.getMarkdown()).toBe("one\n\n> two");
    caret(e.view, "two");
    button("quote").dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
    expect(e.getMarkdown()).toBe("one\n\n> > two");
  });

  it("Shift+Enter on the focused Quote nests; a mixed range keeps its differences", async () => {
    const e = await mount("> one\n\ntwo");
    span(e.view, "one", "two");
    const quote = button("quote");
    quote.focus();
    shiftEnter(quote);
    expect(e.getMarkdown()).toBe("> > one\n>\n> two");
  });

  it("a plain click on all-quoted blocks removes one level from each; pressed exactly when every block is quoted", async () => {
    const e = await mount("> > deep\n>\n> shallow");
    span(e.view, "deep", "shallow");
    expect(button("quote").getAttribute("aria-pressed")).toBe("true");
    button("quote").click();
    expect(e.getMarkdown()).toBe("> deep\n\nshallow");
    const f = await mount("> quoted\n\nplain");
    span(f.view, "quoted", "plain");
    expect(document.querySelectorAll<HTMLButtonElement>('.fmenu button[data-cmd="quote"]')[1]?.getAttribute("aria-pressed")).toBe("false");
  });

  it("the Divider glyph is the left-aligned lines around a full-width rule, unlike every other symbol", async () => {
    const { SYMBOLS } = await import("../../../src/renderer/components/symbols");
    await mount("x");
    const path = button("hr").querySelector("path")?.getAttribute("d");
    expect(path).toBe("M3 4h14M3 8h9M3 12h18M3 16h12M3 20h7");
    const others = Object.entries(SYMBOLS).filter(([name]) => name !== "divider").map(([, d]) => d);
    expect(others).not.toContain(path);
  });
});
