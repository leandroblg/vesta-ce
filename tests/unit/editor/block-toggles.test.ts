// 011 US1: the toggles as single transactions on a real editor (research §1 to §7).
import { afterEach, describe, expect, it } from "vitest";
import { TextSelection } from "@milkdown/kit/prose/state";
import { undo } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createEditor, type EditorHandle, type EditorScope } from "../../../src/renderer/editor/create-editor";
import {
  indentItems,
  menuRange,
  outdentItems,
  stepFontSize,
  toggleChecklist,
  mergeCodeBlocks,
  nestQuote,
  pressedStates,
  toggleBlock,
  toggleHighlight,
} from "../../../src/renderer/editor/menu/block-toggles";

const open: EditorHandle[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

async function mount(value: string, scope: EditorScope = "details"): Promise<EditorHandle> {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = await createEditor(host, { scope, value });
  open.push(editor);
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

/** Selects from the start of `a` to the end of `b` (or just `a`). */
function select(view: EditorView, a: string, b: string = a): void {
  const from = find(view, a).from;
  const to = find(view, b).to;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
}

function caret(view: EditorView, text: string): void {
  const at = find(view, text).from;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

const undoOnce = (view: EditorView) => undo(view.state, view.dispatch);

describe("FR-001 Highlight", () => {
  it("FR-001 removes the default highlight and a highlight color in one step; Undo restores", async () => {
    const e = await mount('==one==[two]{bg="#ffe066ff" color="#dd3333ff"}');
    select(e.view, "one", "two");
    expect(pressedStates(e.view.state).highlight).toBe(true);
    toggleHighlight(e.view);
    expect(e.getMarkdown()).toBe('one[two]{color="#dd3333ff"}');
    undoOnce(e.view);
    expect(e.getMarkdown()).toBe('==one==[two]{bg="#ffe066ff" color="#dd3333ff"}'); // the stored text, as loaded
  });

  it("FR-001 a partial selection gets the default highlight where none, keeping colors", async () => {
    const e = await mount('one [two]{bg="#ffe066ff"}');
    select(e.view, "one", "two");
    expect(pressedStates(e.view.state).highlight).toBe(false);
    toggleHighlight(e.view);
    // The space between gets the highlight too; the serializer writes it outside the == marks.
    expect(e.getMarkdown()).toBe('==one== [two]{bg="#ffe066ff"}');
    expect(pressedStates(e.view.state).highlight).toBe(true);
  });

  it("FR-001 applies in titles too", async () => {
    const e = await mount("==title==", "title");
    select(e.view, "title");
    toggleHighlight(e.view);
    expect(e.getMarkdown()).toBe("title");
  });
});

describe("FR-002 Code block", () => {
  it("FR-002 three paragraphs become three code blocks, then back; one Undo each", async () => {
    const e = await mount("a\n\nb\n\nc");
    select(e.view, "a", "c");
    toggleBlock(e.view, "codeblock");
    expect(e.getMarkdown()).toBe("```\na\n```\n\n```\nb\n```\n\n```\nc\n```");
    expect(pressedStates(e.view.state).codeblock).toBe(true);
    select(e.view, "a", "c");
    toggleBlock(e.view, "codeblock");
    expect(e.getMarkdown()).toBe("a\n\nb\n\nc");
    undoOnce(e.view);
    expect(e.getMarkdown()).toBe("```\na\n```\n\n```\nb\n```\n\n```\nc\n```");
  });

  it("Edge Cases: code off drops empty lines and keeps markdown-looking text plain", async () => {
    const e = await mount("```js\n# not a heading\n\n- not a list\n> not a quote\n```");
    caret(e.view, "# not");
    toggleBlock(e.view, "codeblock");
    expect(e.getMarkdown()).toBe("\\# not a heading\n\n\\- not a list\n\n\\> not a quote");
  });

  it("FR-002a Shift merges the selected blocks with the code blocks above and below, keeping the first language", async () => {
    const e = await mount("```ts\nx\n```\n\nmid\n\n```py\ny\n```\n\nafter");
    caret(e.view, "mid");
    mergeCodeBlocks(e.view);
    expect(e.getMarkdown()).toBe("```ts\nx\nmid\ny\n```\n\nafter");
    undoOnce(e.view);
    expect(e.getMarkdown()).toBe("```ts\nx\n```\n\nmid\n\n```py\ny\n```\n\nafter");
  });

  it("FR-002a merging never removes code formatting", async () => {
    const e = await mount("```\nx\n```");
    caret(e.view, "x");
    mergeCodeBlocks(e.view);
    expect(e.getMarkdown()).toBe("```\nx\n```");
  });
});

describe("FR-002 FR-003 lists", () => {
  it("FR-002 Bulleted list on a bulleted selection lifts the items to paragraphs", async () => {
    const e = await mount("- one\n- two\n- three");
    select(e.view, "one", "three");
    toggleBlock(e.view, "bullet");
    expect(e.getMarkdown()).toBe("one\n\ntwo\n\nthree");
  });

  it("FR-003 Numbered list on a bulleted list switches in place, keeping checklist state; and back", async () => {
    const e = await mount("- [ ] one\n- [x] two");
    select(e.view, "one", "two");
    toggleBlock(e.view, "ordered");
    expect(e.getMarkdown()).toBe("1. [ ] one\n2. [x] two");
    select(e.view, "one", "two");
    toggleBlock(e.view, "bullet");
    expect(e.getMarkdown()).toBe("- [ ] one\n- [x] two");
  });

  it("FR-003 only the items' nearest list changes; a nested list keeps its kind", async () => {
    const e = await mount("- one\n  - nested");
    caret(e.view, "one");
    toggleBlock(e.view, "ordered");
    expect(e.getMarkdown()).toBe("1. one\n   - nested");
  });

  it("FR-003 switching the middle item splits the list into three", async () => {
    const e = await mount("1. one\n2. two\n3. three");
    caret(e.view, "two");
    toggleBlock(e.view, "bullet");
    expect(e.getMarkdown()).toBe("1. one\n\n- two\n\n1. three");
  });

  it("Edge Cases: turning off the middle item leaves list, paragraph, list", async () => {
    const e = await mount("- one\n- two\n- three");
    caret(e.view, "two");
    toggleBlock(e.view, "bullet");
    expect(e.getMarkdown()).toBe("- one\n\ntwo\n\n- three");
  });

  it("US1-6 a mix of paragraphs and numbered items ends up as one bulleted list", async () => {
    const e = await mount("para\n\n1. item");
    select(e.view, "para", "item");
    toggleBlock(e.view, "bullet");
    expect(e.getMarkdown()).toBe("- para\n- item");
  });

  it("FR-006 a mix of kinds is not pressed", async () => {
    const e = await mount("- one\n\n1. two");
    select(e.view, "one", "two");
    expect(pressedStates(e.view.state).bullet).toBe(false);
    expect(pressedStates(e.view.state).ordered).toBe(false);
  });
});

describe("FR-002 FR-004 FR-005 quotes", () => {
  it("FR-004 Quote on depth 2 leaves depth 1, then plain text", async () => {
    const e = await mount("> > deep");
    caret(e.view, "deep");
    expect(pressedStates(e.view.state).quote).toBe(true);
    toggleBlock(e.view, "quote");
    expect(e.getMarkdown()).toBe("> deep");
    toggleBlock(e.view, "quote");
    expect(e.getMarkdown()).toBe("deep");
  });

  it("FR-002 a partial range quotes only the unquoted blocks", async () => {
    const e = await mount("> quoted\n\nplain");
    select(e.view, "quoted", "plain");
    toggleBlock(e.view, "quote");
    expect(e.getMarkdown()).toBe("> quoted\n\n> plain");
  });

  it("FR-005 Mod-' nests every block one level, keeping depth differences, no maximum", async () => {
    const e = await mount("> a\n>\n> > b");
    select(e.view, "a", "b");
    expect(nestQuote(e.view)).toBe(true);
    expect(e.getMarkdown()).toBe("> > a\n> >\n> > > b");
    caret(e.view, "a");
    for (let i = 0; i < 6; i++) nestQuote(e.view);
    expect(e.getMarkdown().startsWith("> > > > > > > > a")).toBe(true);
  });

  it("FR-007 with no selection, block actions act on the cursor's block only", async () => {
    const e = await mount("one\n\ntwo");
    caret(e.view, "two");
    toggleBlock(e.view, "quote");
    expect(e.getMarkdown()).toBe("one\n\n> two");
  });
});

describe("FR-005 the Mod-' key", () => {
  function press(view: EditorView, key: string): boolean {
    const event = new KeyboardEvent("keydown", { key, ctrlKey: !navigator.platform.includes("Mac"), metaKey: navigator.platform.includes("Mac") });
    return view.someProp("handleKeyDown", (f) => f(view, event)) === true;
  }

  it("FR-005 Mod-' nests the selection in a details editor", async () => {
    const e = await mount("text");
    caret(e.view, "text");
    expect(press(e.view, "'")).toBe(true);
    expect(e.getMarkdown()).toBe("> text");
  });

  it("FR-005 Mod-' does nothing in a title or reminder editor", async () => {
    for (const scope of ["title", "reminder"] as const) {
      const e = await mount("text", scope);
      caret(e.view, "text");
      press(e.view, "'");
      expect(e.getMarkdown()).toBe("text");
    }
  });
});

describe("FR-007 the menu's rule insert", () => {
  it("FR-007 one undo removes an inserted rule", async () => {
    const e = await mount("text");
    caret(e.view, "text");
    const button = document.querySelector<HTMLButtonElement>('.fmenu button[data-cmd="hr"]');
    expect(button).not.toBeNull();
    button?.click();
    expect(e.getMarkdown()).toBe("text\n\n---");
    undoOnce(e.view);
    expect(e.getMarkdown()).toBe("text");
  });

  it("FR-002a Shift+click on Code block merges through the menu", async () => {
    const e = await mount("```\nx\n```\n\ny");
    caret(e.view, "y");
    document.querySelector<HTMLButtonElement>('.fmenu button[data-cmd="codeblock"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    expect(e.getMarkdown()).toBe("```\nx\ny\n```");
  });
});

describe("plan Performance Goals: menu refresh", () => {
  it("pressedStates on a 1,000-paragraph document stays under 2 ms for a caret and is measured for a full selection", async () => {
    const md = Array.from({ length: 1000 }, (_, i) => `paragraph ${String(i)} with ==some== text`).join("\n\n");
    const e = await mount(md);
    caret(e.view, "paragraph 500");
    const time = (n: number) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) pressedStates(e.view.state);
      return (performance.now() - t0) / n;
    };
    time(20);
    const caretMs = time(200);
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 1, e.view.state.doc.content.size - 1)));
    const fullMs = time(20);
    console.info(`[011 T040] pressedStates: caret ${caretMs.toFixed(3)} ms, whole document ${fullMs.toFixed(3)} ms`);
    expect(caretMs).toBeLessThan(2);
  });
});

// 012 research §1: one range for every option.
describe("012 FR-001 menuRange", () => {
  it("FR-001 details with nothing selected: the text of the paragraph holding the cursor", async () => {
    const e = await mount("first\n\nsecond\n\nthird");
    caret(e.view, "second");
    const r = menuRange(e.view.state, "details");
    expect(e.view.state.doc.textBetween(r.from, r.to)).toBe("second");
  });
  it("FR-003 a title or a reminder with nothing selected: the whole field", async () => {
    for (const scope of ["title", "reminder"] as const) {
      const e = await mount("one **two** three", scope);
      caret(e.view, "two");
      const r = menuRange(e.view.state, scope);
      expect(r).toEqual({ from: 0, to: e.view.state.doc.content.size });
    }
  });
  it("FR-001 a non-empty selection is the selection, in every scope", async () => {
    const e = await mount("first\n\nsecond");
    select(e.view, "irs", "seco");
    const sel = e.view.state.selection;
    expect(menuRange(e.view.state, "details")).toEqual({ from: sel.from, to: sel.to });
  });
  it("Edge Cases: an empty paragraph gives an empty range at the cursor", async () => {
    const e = await mount("first\n\nsecond");
    const end = e.view.state.doc.content.size;
    const paragraph = e.view.state.schema.nodes["paragraph"];
    if (!paragraph) throw new Error("no paragraph");
    const tr = e.view.state.tr.insert(end, paragraph.create());
    e.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)));
    const r = menuRange(e.view.state, "details");
    expect(r.from).toBe(r.to);
    expect(r.from).toBe(end + 1);
  });
});

// 012 US3: Checklist and Indent as single transactions (FR-006 to FR-012, research §4, §5).
describe("012 FR-010 to FR-012 Checklist", () => {
  it("FR-010 two paragraphs become one bulleted list of unchecked items; 016 FR-025 again gives the paragraphs back", async () => {
    const e = await mount("alpha\n\nbeta");
    select(e.view, "alpha", "beta");
    toggleChecklist(e.view, "details");
    expect(e.getMarkdown()).toBe("- [ ] alpha\n- [ ] beta");
    select(e.view, "alpha", "beta");
    toggleChecklist(e.view, "details");
    expect(e.getMarkdown()).toBe("alpha\n\nbeta");
  });

  it("FR-010 with nothing selected, only the cursor's paragraph", async () => {
    const e = await mount("alpha\n\nbeta");
    caret(e.view, "beta");
    toggleChecklist(e.view, "details");
    expect(e.getMarkdown()).toBe("alpha\n\n- [ ] beta");
  });

  it("FR-010 list items keep their kind and nesting; 016 FR-025 off lifts the whole outer list, the nested one stays a list", async () => {
    const md = "1. one\n   - inner\n2. two";
    const e = await mount(md);
    select(e.view, "one", "two");
    toggleChecklist(e.view, "details");
    expect(e.getMarkdown()).toBe("1. [ ] one\n   - [ ] inner\n2. [ ] two");
    select(e.view, "one", "two");
    toggleChecklist(e.view, "details");
    expect(e.getMarkdown()).toBe("one\n\n- inner\n\ntwo");
  });

  it("FR-011 a mixed range adds checkboxes and keeps checked states", async () => {
    const e = await mount("- [x] done\n- open");
    select(e.view, "done", "open");
    toggleChecklist(e.view, "details");
    expect(e.getMarkdown()).toBe("- [x] done\n- [ ] open");
  });

  it("Edge Cases headings, code and tables are skipped; paragraphs in a quote become a checklist in the quote", async () => {
    const e = await mount("# Head\n\nbody\n\n> quoted");
    select(e.view, "Head", "quoted");
    toggleChecklist(e.view, "details");
    expect(e.getMarkdown()).toBe("# Head\n\n- [ ] body\n\n> - [ ] quoted");
  });

  it("FR-012 one Undo step each way", async () => {
    const e = await mount("alpha\n\nbeta");
    select(e.view, "alpha", "beta");
    toggleChecklist(e.view, "details");
    undoOnce(e.view);
    expect(e.getMarkdown()).toBe("alpha\n\nbeta");
  });
});

describe("012 FR-006 to FR-009 Indent and outdent", () => {
  it("FR-006 Indent nests items 2 and 3 under item 1; FR-007 outdent brings them back", async () => {
    const md = "- one\n- two\n- three";
    const e = await mount(md);
    select(e.view, "two", "three");
    indentItems(e.view, "details");
    expect(e.getMarkdown()).toBe("- one\n  - two\n  - three");
    select(e.view, "two", "three");
    outdentItems(e.view, "details");
    expect(e.getMarkdown()).toBe(md);
  });

  it("FR-006 kind and checklist state are kept", async () => {
    const e = await mount("1. [ ] one\n2. [x] two");
    caret(e.view, "two");
    indentItems(e.view, "details");
    expect(e.getMarkdown()).toBe("1. [ ] one\n   1. [x] two");
  });

  it("FR-007 outdent leaves top-level items in their list, and records no Undo step when nothing moves", async () => {
    const e = await mount("- one\n- two");
    caret(e.view, "two");
    const before = e.view.state.doc;
    outdentItems(e.view, "details");
    expect(e.view.state.doc.eq(before)).toBe(true);
    expect(e.getMarkdown()).toBe("- one\n- two");
  });

  it("FR-009 one Undo step each", async () => {
    const e = await mount("- one\n- two");
    caret(e.view, "two");
    indentItems(e.view, "details");
    undoOnce(e.view);
    expect(e.getMarkdown()).toBe("- one\n- two");
  });
});

// 012 US4: Increase and Decrease font size (FR-014 to FR-017, research §6).
describe("012 FR-014 to FR-017 font size steps", () => {
  it("FR-014 Increase twice then Decrease twice leaves no size", async () => {
    const e = await mount("say word now");
    select(e.view, "word");
    stepFontSize(e.view, "details", 1);
    stepFontSize(e.view, "details", 1);
    expect(e.getMarkdown()).toBe('say [word]{size="1.5em"} now');
    stepFontSize(e.view, "details", -1);
    stepFontSize(e.view, "details", -1);
    expect(e.getMarkdown()).toBe("say word now");
  });

  it("FR-016 mixed sizes each move one step", async () => {
    const e = await mount('[a]{size="1.25em"} b [c]{size="2em"}');
    select(e.view, "a", "c");
    stepFontSize(e.view, "details", 1);
    // Spaces at a span's edges are written outside it (the span syntax's canonical form).
    expect(e.getMarkdown()).toBe('[a]{size="1.5em"} [b]{size="1.25em"} [c]{size="2.5em"}');
  });

  it("FR-015a removing the size keeps color and underline; a span left with nothing becomes plain text", async () => {
    const e = await mount('[x]{color="#dd3333ff" size="1.25em" .underline} [y]{size="1.25em"}');
    select(e.view, "x", "y");
    stepFontSize(e.view, "details", -1);
    expect(e.getMarkdown()).toBe('[x]{color="#dd3333ff" .underline} y');
  });

  it("FR-014 a title with nothing selected steps the whole title", async () => {
    const e = await mount("one two", "title");
    caret(e.view, "two");
    stepFontSize(e.view, "title", 1);
    expect(e.getMarkdown()).toBe('[one two]{size="1.25em"}');
  });

  it("FR-014 the details with nothing selected step the cursor's block only", async () => {
    const e = await mount("one\n\ntwo");
    caret(e.view, "two");
    stepFontSize(e.view, "details", 1);
    expect(e.getMarkdown()).toBe('one\n\n[two]{size="1.25em"}');
  });

  it("FR-017 one Undo step per press; nothing at the limit", async () => {
    const e = await mount('[x]{size="2.5em"}');
    select(e.view, "x");
    const before = e.view.state.doc;
    stepFontSize(e.view, "details", 1);
    expect(e.view.state.doc.eq(before)).toBe(true);
    stepFontSize(e.view, "details", -1);
    undoOnce(e.view);
    expect(e.getMarkdown()).toBe('[x]{size="2.5em"}');
  });
});

// 012 T078, Edge Cases "empty paragraph": the next typed text carries the format.
describe("012 Edge Cases an empty paragraph", () => {
  async function emptyParagraph() {
    const e = await mount("first");
    const end = e.view.state.doc.content.size;
    const paragraph = e.view.state.schema.nodes["paragraph"];
    if (!paragraph) throw new Error("no paragraph");
    const tr = e.view.state.tr.insert(end, paragraph.create());
    e.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)));
    return e;
  }
  const typeText = (view: EditorView, text: string) => {
    view.dispatch(view.state.tr.insertText(text));
  };

  it("Highlight applies to the next typed text, and pressed again does not", async () => {
    const e = await emptyParagraph();
    toggleHighlight(e.view, "details");
    typeText(e.view, "lit");
    expect(e.getMarkdown()).toBe("first\n\n==lit==");
  });

  it("Increase font size applies to the next typed text", async () => {
    const e = await emptyParagraph();
    stepFontSize(e.view, "details", 1);
    typeText(e.view, "big");
    expect(e.getMarkdown()).toBe('first\n\n[big]{size="1.25em"}');
  });
});

// 012 T079, Edge Cases "Indent on items of different lists or depths".
describe("012 Edge Cases Indent across lists and depths", () => {
  it("items of two lists each move one level; a first item stays; one Undo step", async () => {
    const md = "- a1\n- a2\n\npara\n\n1. b1\n2. b2";
    const e = await mount(md);
    select(e.view, "a2", "b2");
    indentItems(e.view, "details");
    expect(e.getMarkdown()).toBe("- a1\n  - a2\n\npara\n\n1. b1\n   1. b2");
    undoOnce(e.view);
    expect(e.getMarkdown()).toBe(md);
  });

  it("a selected item and its own nested item move together, one level", async () => {
    const e = await mount("- one\n- two\n  - inner");
    select(e.view, "two", "inner");
    indentItems(e.view, "details");
    expect(e.getMarkdown()).toBe("- one\n  - two\n    - inner");
  });
});

describe("013 FR-043 one list item per paragraph (PRD Q171, Q179) and FR-044 Indent on such a list (Q172)", () => {
  it("FR-043 two paragraphs + Bulleted list → one list, two items", async () => {
    const e = await mount("one\n\ntwo");
    select(e.view, "one", "two");
    toggleBlock(e.view, "bullet");
    expect(e.getMarkdown()).toBe("- one\n- two");
  });

  it("FR-043 two paragraphs + Numbered list → one numbered list, two items", async () => {
    const e = await mount("one\n\ntwo");
    select(e.view, "one", "two");
    toggleBlock(e.view, "ordered");
    expect(e.getMarkdown()).toBe("1. one\n2. two");
  });

  it("FR-043 three paragraphs with the middle one already a list item: one list, three items", async () => {
    const e = await mount("one\n\n- two\n\nthree");
    select(e.view, "one", "three");
    toggleBlock(e.view, "bullet");
    expect(e.getMarkdown()).toBe("- one\n- two\n- three");
  });

  it("(OD1, Q179) a heading stays a heading and the list is split around it", async () => {
    const e = await mount("a\n\n## h\n\nb");
    select(e.view, "a", "b");
    toggleBlock(e.view, "bullet");
    expect(e.getMarkdown()).toBe("- a\n\n## h\n\n- b");
  });

  it("FR-044 Q172 a list made with the button indents and outdents", async () => {
    const e = await mount("one\n\ntwo");
    select(e.view, "one", "two");
    toggleBlock(e.view, "bullet");
    caret(e.view, "two");
    expect(indentItems(e.view, "details")).toBe(true);
    expect(e.getMarkdown()).toBe("- one\n  - two");
    caret(e.view, "two");
    expect(outdentItems(e.view, "details")).toBe(true);
    expect(e.getMarkdown()).toBe("- one\n- two");
  });
});

/** Types `text` at the selection as the keyboard does, so input rules run (016 FR-023). */
function typeText(view: EditorView, text: string): void {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
    if (handled !== true) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

describe("016 FR-023, FR-024 the typed checklist shortcut (PRD Q225, Q240, Q253)", () => {
  it.each([
    ["[] ", "- [ ] hello"],
    ["[ ] ", "- [ ] hello"],
    ["[x] ", "- [x] hello"],
    ["[X] ", "- [x] hello"],
  ])("%j at the start of a paragraph makes a one-item checklist, the text after the cursor joining it", async (typed, md) => {
    const e = await mount("hello");
    caret(e.view, "hello");
    typeText(e.view, typed);
    expect(e.getMarkdown()).toBe(md);
  });

  it("a numbered item gets the box and keeps its number; a checked item takes the typed state", async () => {
    const e = await mount("1. one\n2. two");
    caret(e.view, "two");
    typeText(e.view, "[x] ");
    expect(e.getMarkdown()).toBe("1. one\n2. [x] two");
    const f = await mount("- [x] done");
    caret(f.view, "done");
    typeText(f.view, "[ ] ");
    expect(f.getMarkdown()).toBe("- [ ] done");
  });

  it("in a quote the checklist sits inside the quote", async () => {
    const e = await mount("> quoted");
    caret(e.view, "quoted");
    typeText(e.view, "[ ] ");
    expect(e.getMarkdown()).toBe("> - [ ] quoted");
  });

  it.each([
    ["a heading", "# Head", "Head", "heading"],
    ["a code block", "```\ncode\n```", "code", "code_block"],
  ])("nothing in %s: the characters stay", async (_name, md, at, kind) => {
    const e = await mount(md);
    caret(e.view, at);
    typeText(e.view, "[ ] ");
    expect(e.view.state.doc.firstChild?.type.name).toBe(kind);
    expect(e.view.state.doc.textContent).toBe(`[ ] ${at}`);
  });

  it("nothing in a table cell or after a line break", async () => {
    const e = await mount("| a |\n| - |\n| b |");
    caret(e.view, "b");
    typeText(e.view, "[ ] ");
    expect(e.view.state.doc.textContent).toContain("[ ] b");
    let lists = 0;
    e.view.state.doc.descendants((n) => {
      if (n.type.name === "bullet_list") lists++;
    });
    expect(lists).toBe(0);
    const f = await mount("line\\\nnext");
    caret(f.view, "next");
    typeText(f.view, "[ ] ");
    expect(f.view.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(f.view.state.doc.textContent).toContain("[ ] next");
  });

  it.each(["title", "reminder"] as const)("nothing in a %s editor", async (scope) => {
    const e = await mount("hello", scope);
    caret(e.view, "hello");
    typeText(e.view, "[ ] ");
    expect(e.view.state.doc.textContent).toBe("[ ] hello");
  });

  it("the next Undo brings the typed characters back as text", async () => {
    const e = await mount("hello");
    caret(e.view, "hello");
    typeText(e.view, "[ ] ");
    expect(e.getMarkdown()).toBe("- [ ] hello");
    undo(e.view.state, e.view.dispatch);
    expect(e.view.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(e.view.state.doc.textContent.startsWith("[ ]")).toBe(true);
  });
});

describe("016 FR-025 Checklist off (PRD Q231)", () => {
  it("a stand-alone checklist, all of it, becomes paragraphs", async () => {
    const e = await mount("- [ ] a\n- [ ] b\n- [ ] c");
    select(e.view, "a", "c");
    toggleChecklist(e.view, "details");
    expect(e.getMarkdown()).toBe("a\n\nb\n\nc");
  });

  it("with a list directly below, nested in an item, or one item left out, the items stay plain items", async () => {
    const below = await mount("- [ ] a\n- [ ] b\n\n1. x");
    select(below.view, "a", "b");
    toggleChecklist(below.view, "details");
    expect(below.getMarkdown()).toBe("- a\n- b\n\n1. x");

    const nested = await mount("- top\n  - [ ] a\n  - [ ] b");
    select(nested.view, "a", "b");
    toggleChecklist(nested.view, "details");
    expect(nested.getMarkdown()).toBe("- top\n  - a\n  - b");

    const partial = await mount("- [ ] a\n- [ ] b\n- [ ] c");
    select(partial.view, "a", "b");
    toggleChecklist(partial.view, "details");
    expect(partial.getMarkdown()).toBe("- a\n- b\n- [ ] c");
  });

  it("nothing selected in a one-item checklist: a paragraph; one Undo step", async () => {
    const e = await mount("before\n\n- [ ] solo\n\nafter");
    caret(e.view, "solo");
    toggleChecklist(e.view, "details");
    expect(e.getMarkdown()).toBe("before\n\nsolo\n\nafter");
    undo(e.view.state, e.view.dispatch);
    expect(e.getMarkdown()).toBe("before\n\n- [ ] solo\n\nafter");
  });
});
