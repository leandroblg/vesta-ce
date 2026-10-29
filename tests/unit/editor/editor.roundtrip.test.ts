// SC-001, constitution III: one test per row of spec FR-015a and FR-015, in each scope the row is allowed in.
// Each test loads the stored form (unchanged on read-back, FR-016), then applies the row's input rule,
// command or paste to plain text and compares the stored text with the canonical form.
import { afterEach, describe, expect, it } from "vitest";
import { Slice } from "@milkdown/kit/prose/model";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createEditor, type EditorHandle, type EditorScope } from "../../../src/renderer/editor/create-editor";

const SHA = "0123456789abcdef".repeat(4);
const IMAGE = `assets/${SHA}.png`;
const FILE = `assets/${SHA}.pdf`;
const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const TITLE_SCOPES: EditorScope[] = ["title", "reminder", "details"];
const DETAILS: EditorScope[] = ["details"];
const INLINE: EditorScope[] = ["title", "reminder"];

const open: EditorHandle[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

async function mount(scope: EditorScope, value = ""): Promise<EditorHandle> {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = await createEditor(host, { scope, value });
  open.push(editor);
  return editor;
}

/** Types text as keystrokes, so input rules run. */
function type(view: EditorView, text: string): void {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
    );
    if (handled !== true) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

/** Pastes plain text (markdown), as the clipboard plugin receives it. */
function paste(view: EditorView, text: string): void {
  const event = {
    clipboardData: { getData: (kind: string) => (kind === "text/plain" ? text : "") },
  } as unknown as ClipboardEvent;
  const handled = view.someProp("handlePaste", (f) => f(view, event, Slice.empty));
  expect(handled).toBe(true);
}

/** Selects the first occurrence of `text` in the document. */
function select(view: EditorView, text: string): { from: number; to: number } {
  const ranges: { from: number; to: number }[] = [];
  view.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text?.indexOf(text) ?? -1) : -1;
    if (at >= 0) ranges.push({ from: pos + at, to: pos + at + text.length });
  });
  const range = ranges[0];
  if (!range) throw new Error(`text not found: ${text}`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)));
  return range;
}

function addMark(view: EditorView, text: string, name: string, attrs?: Record<string, unknown>): void {
  const { from, to } = select(view, text);
  const type = view.state.schema.marks[name];
  if (!type) throw new Error(`no mark ${name}`);
  view.dispatch(view.state.tr.addMark(from, to, type.create(attrs)));
}

function insertNode(view: EditorView, name: string, attrs?: Record<string, unknown>): void {
  const type = view.state.schema.nodes[name];
  if (!type) throw new Error(`no node ${name}`);
  view.dispatch(view.state.tr.replaceSelectionWith(type.create(attrs), false));
}

const span = (attrs: Record<string, unknown>) => ({
  color: null,
  bg: null,
  size: null,
  underline: false,
  other: [],
  ...attrs,
});

type Row = {
  row: string;
  scopes: EditorScope[];
  /** The canonical stored forms of the row. */
  stored: string[];
  /** Applies the row to an empty editor; the result must equal `expected`. */
  apply: (view: EditorView, scope: EditorScope) => void;
  expected: string | ((scope: EditorScope) => string);
};

const FR_015A: Row[] = [
  {
    row: "Bold, italic, inline code",
    scopes: TITLE_SCOPES,
    stored: ["**text**", "*text*", "`text`", "**bold** *italic* `code`"],
    apply: (view) => {
      type(view, "**bold** *italic* `code` ");
    },
    expected: "**bold** *italic* `code`",
  },
  {
    row: "Link",
    scopes: TITLE_SCOPES,
    stored: ["[text](https://example.com)", "[mail](mailto:me@example.com)"],
    apply: (view) => {
      type(view, "text");
      addMark(view, "text", "link", { href: "https://example.com" });
    },
    expected: "[text](https://example.com)",
  },
  {
    row: "Strikethrough",
    scopes: TITLE_SCOPES,
    stored: ["~~text~~"],
    apply: (view) => {
      type(view, "~~text~~");
    },
    expected: "~~text~~",
  },
  {
    row: "Underline, text color, highlight, font size",
    scopes: TITLE_SCOPES,
    stored: ['[u]{.underline} [c]{color="#dd3333"} ==h== [s]{size="1.5em"}'],
    apply: (view) => {
      type(view, "u c ==h== s");
      addMark(view, "u", "vestaSpan", span({ underline: true }));
      addMark(view, "c", "vestaSpan", span({ color: "#dd3333" }));
      addMark(view, "s", "vestaSpan", span({ size: "1.5em" }));
    },
    expected: '[u]{.underline} [c]{color="#dd3333ff"} ==h== [s]{size="1.5em"}',
  },
  {
    row: "Heading",
    scopes: TITLE_SCOPES,
    stored: ["# text", "### text", "###### text"],
    apply: (view) => {
      type(view, "## text");
    },
    expected: "## text",
  },
  {
    row: "Emoji",
    scopes: TITLE_SCOPES,
    stored: ["🎉 party", "a 👍🏽 b"],
    apply: (view) => {
      type(view, ":tada: party");
    },
    expected: "🎉 party",
  },
  {
    row: "Inline image (titles, reminders) and image (details)",
    scopes: TITLE_SCOPES,
    stored: [`![photo.png](${IMAGE})`, `Renew ![photo.png](${IMAGE}) now`],
    apply: (view) => {
      type(view, "Renew ");
      insertNode(view, "image", { src: IMAGE, alt: "photo.png", title: "" });
      type(view, " now");
    },
    expected: `Renew ![photo.png](${IMAGE}) now`,
  },
  {
    row: "Link to a stored file",
    scopes: DETAILS,
    stored: [`[report.pdf](${FILE})`],
    apply: (view) => {
      type(view, "report.pdf");
      addMark(view, "report.pdf", "link", { href: FILE });
    },
    expected: `[report.pdf](${FILE})`,
  },
  {
    row: "Line break (details)",
    scopes: DETAILS,
    stored: ["line\\\nbreak", "one\n\ntwo"],
    apply: (view) => {
      type(view, "line");
      insertNode(view, "hardbreak");
      type(view, "break");
    },
    expected: "line\\\nbreak",
  },
  {
    row: "Horizontal rule",
    scopes: DETAILS,
    stored: ["---", "above\n\n---\n\nbelow"],
    apply: (view) => {
      type(view, "above");
      paste(view, "\n\n---\n\nbelow");
    },
    expected: "above\n\n---\n\nbelow",
  },
  {
    row: "Bulleted and numbered lists",
    scopes: DETAILS,
    stored: ["- item\n- two", "1. one\n2. two", "- item\n  - nested", "1. one\n   1. nested"],
    apply: (view) => {
      type(view, "- item");
    },
    expected: "- item",
  },
  {
    row: "Block quote",
    scopes: DETAILS,
    stored: ["> text"],
    apply: (view) => {
      type(view, "> text");
    },
    expected: "> text",
  },
  {
    row: "Table",
    scopes: DETAILS,
    stored: ["| abc | def |\n| --- | --- |\n| 1   | 2   |"],
    apply: (view) => {
      paste(view, "| abc | def |\n| --- | --- |\n| 1 | 2 |");
    },
    expected: "| abc | def |\n| --- | --- |\n| 1   | 2   |",
  },
  {
    row: "Checklist item",
    scopes: DETAILS,
    stored: ["- [ ] item", "- [x] item", "- [ ] one\n- [x] two"],
    apply: (view) => {
      type(view, "- [ ] item");
    },
    expected: "- [ ] item",
  },
  {
    row: "Code block",
    scopes: DETAILS,
    stored: ["```js\nlet a = 1;\n```", "```\nplain\n```"],
    apply: (view) => {
      type(view, "```js ");
      type(view, "let a = 1;");
    },
    expected: "```js\nlet a = 1;\n```",
  },
  {
    row: "Collapsible section",
    scopes: DETAILS,
    stored: ["<details><summary>title</summary>\n\nbody\n\n</details>"],
    apply: (view) => {
      paste(view, "<details><summary>title</summary>\n\nbody\n\n</details>");
    },
    expected: "<details><summary>title</summary>\n\nbody\n\n</details>",
  },
  {
    row: "Footnote",
    scopes: DETAILS,
    stored: ["Text[^1]\n\n[^1]: note"],
    apply: (view) => {
      paste(view, "Text[^1]\n\n[^1]: note");
    },
    expected: "Text[^1]\n\n[^1]: note",
  },
  {
    row: "YouTube embed",
    scopes: DETAILS,
    stored: [YOUTUBE, `<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>`],
    apply: (view) => {
      paste(view, YOUTUBE);
    },
    expected: YOUTUBE,
  },
  {
    row: "Inline HTML",
    scopes: DETAILS,
    stored: ["a <b>bold</b> c", "<sub>x</sub>"],
    apply: (view) => {
      paste(view, "a <b>bold</b> c");
    },
    expected: "a <b>bold</b> c",
  },
];

const FR_015: Row[] = [
  {
    row: "Highlight, default color",
    scopes: TITLE_SCOPES,
    stored: ["==text=="],
    apply: (view) => {
      type(view, "==text==");
    },
    expected: "==text==",
  },
  {
    row: "Highlight, chosen color",
    scopes: TITLE_SCOPES,
    stored: ['[text]{bg="#ffe066"}'],
    apply: (view) => {
      type(view, "text");
      addMark(view, "text", "vestaSpan", span({ bg: "#ffe066" }));
    },
    expected: '[text]{bg="#ffe066ff"}',
  },
  {
    row: "Text color",
    scopes: TITLE_SCOPES,
    stored: ['[text]{color="#dd3333"}', '[text]{color="#d33"}'],
    apply: (view) => {
      type(view, "text");
      addMark(view, "text", "vestaSpan", span({ color: "#D33" }));
    },
    expected: '[text]{color="#dd3333ff"}',
  },
  {
    row: "Underline",
    scopes: TITLE_SCOPES,
    stored: ["[text]{.underline}"],
    apply: (view) => {
      type(view, "text");
      addMark(view, "text", "vestaSpan", span({ underline: true }));
    },
    expected: "[text]{.underline}",
  },
  {
    row: "Font size",
    scopes: TITLE_SCOPES,
    stored: ['[text]{size="1.5em"}'],
    apply: (view) => {
      type(view, "text");
      addMark(view, "text", "vestaSpan", span({ size: "1.5em" }));
    },
    expected: '[text]{size="1.5em"}',
  },
  {
    row: "Combined",
    scopes: TITLE_SCOPES,
    stored: ['[text]{color="#dd3333" bg="#ffe066" .underline}'],
    apply: (view) => {
      type(view, "text");
      addMark(view, "text", "vestaSpan", span({ color: "#dd3333", bg: "#ffe066", underline: true }));
    },
    expected: '[text]{color="#dd3333ff" bg="#ffe066ff" .underline}',
  },
];

for (const [table, rows] of [
  ["FR-015a", FR_015A],
  ["FR-015", FR_015],
] as const) {
  describe(`${table} stored forms`, () => {
    for (const row of rows) {
      describe(row.row, () => {
        it.each(row.scopes)("round-trips in the %s scope", async (scope) => {
          for (const stored of row.stored) {
            const loaded = await mount(scope, stored);
            expect(loaded.getMarkdown(), `read back: ${stored}`).toBe(stored);
          }
          const editor = await mount(scope);
          row.apply(editor.view, scope);
          const expected = typeof row.expected === "string" ? row.expected : row.expected(scope);
          expect(editor.getMarkdown()).toBe(expected);
          // What the editor writes reads back unchanged.
          const again = await mount(scope, expected);
          expect(again.getMarkdown()).toBe(expected);
        });
      });
    }
  });
}

describe("FR-015b rules", () => {
  it.each(INLINE)("keeps out-of-scope markdown in the %s scope as text, unchanged", async (scope) => {
    for (const stored of ["- item", "> quote", "1. one", "---", "a <b>x</b>", "| a |", "[^1]", "```js"]) {
      const editor = await mount(scope, stored);
      expect(editor.view.state.doc.childCount).toBe(1);
      expect(editor.getMarkdown(), stored).toBe(stored);
    }
  });

  it.each(INLINE)("keeps markdown typed for a block feature as text in the %s scope", async (scope) => {
    const editor = await mount(scope);
    type(editor.view, "- item");
    expect(editor.view.state.doc.child(0).type.name).toBe("paragraph");
    expect(editor.view.state.doc.textContent).toBe("- item");
    expect(editor.getMarkdown()).toBe("\\- item");
  });

  it("keeps the spelling of an unedited block while an edited one is canonical", async () => {
    const editor = await mount("details", "_x_\n\n* item\n\n_y_");
    const { view } = editor;
    select(view, "y");
    type(view, "z");
    expect(editor.getMarkdown()).toBe("_x_\n\n* item\n\n*z*");
  });

  it("keeps link definitions the editor does not show", async () => {
    const editor = await mount("details", "See [docs][d].\n\nOther\n\n[d]: https://example.com");
    select(editor.view, "Other");
    type(editor.view, "Changed");
    expect(editor.getMarkdown()).toBe("See [docs][d].\n\nChanged\n\n[d]: https://example.com");
  });

  it("ticking a checklist item changes only [ ] to [x] (FR-018)", async () => {
    const stored = "- [ ] one\n- [ ] two\n\nafter";
    const editor = await mount("details", stored);
    const { view } = editor;
    let target = -1;
    view.state.doc.descendants((node, pos) => {
      if (target < 0 && node.type.name === "list_item" && node.attrs.checked === false) target = pos;
    });
    const item = view.state.doc.nodeAt(target);
    view.dispatch(view.state.tr.setNodeMarkup(target, undefined, { ...item?.attrs, checked: true }));
    expect(editor.getMarkdown()).toBe("- [x] one\n- [ ] two\n\nafter");
  });

  /** Toggles the n-th task item (0-based) of the document, as a click on its box does. */
  function tick(editor: EditorHandle, n: number): void {
    const { view } = editor;
    const items: { pos: number; checked: boolean }[] = [];
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "list_item" && typeof node.attrs.checked === "boolean")
        items.push({ pos, checked: node.attrs.checked });
    });
    const item = items[n];
    if (!item) throw new Error(`no task item ${String(n)}`);
    const node = view.state.doc.nodeAt(item.pos);
    view.dispatch(view.state.tr.setNodeMarkup(item.pos, undefined, { ...node?.attrs, checked: !item.checked }));
  }

  it.each([
    ["* [ ] a\n* [ ] b", 0, "* [x] a\n* [ ] b"],
    ["+ [x] a\n+ [X] b", 1, "+ [x] a\n+ [ ] b"],
    ["1) [ ] one\n2) [x] two", 1, "1) [ ] one\n2) [ ] two"],
    ["- [ ] a\n  * [ ] nested", 1, "- [ ] a\n  * [x] nested"],
    ["intro\n\n* [ ] a\n\n_kept_", 0, "intro\n\n* [x] a\n\n_kept_"],
  ])("ticking keeps the list's spelling: %j, item %i (FR-018)", async (stored, n, expected) => {
    const editor = await mount("details", stored);
    tick(editor, n);
    expect(editor.getMarkdown()).toBe(expected);
  });

  it("a tick together with a text edit in the same list writes the list canonically", async () => {
    const editor = await mount("details", "* [ ] a\n* [ ] b");
    tick(editor, 0);
    select(editor.view, "b");
    type(editor.view, "c");
    expect(editor.getMarkdown()).toBe("- [x] a\n- [ ] c");
  });

  it("a typed :tada: becomes 🎉 (FR-020)", async () => {
    const editor = await mount("details");
    type(editor.view, "yay :tada:");
    expect(editor.view.state.doc.textContent).toBe("yay 🎉");
    expect(editor.getMarkdown()).toBe("yay 🎉");
  });

  it("escapes literal syntax typed as text", async () => {
    const editor = await mount("details");
    type(editor.view, "a [b]{c} ==d ~~e");
    expect(editor.getMarkdown()).toBe("a \\[b]\\{c\\} \\==d \\~\\~e");
    const again = await mount("details", editor.getMarkdown());
    expect(again.view.state.doc.textContent).toBe("a [b]{c} ==d ~~e");
  });

  it("keeps unknown span attributes through a paste", async () => {
    const editor = await mount("details");
    paste(editor.view, '[t]{lang="x" .foo}');
    expect(editor.getMarkdown()).toBe('[t]{lang="x" .foo}');
  });

  it("a pasted link keeps its ref and drops the hint tooltip; a pasted image keeps its ref", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = await createEditor(host, {
      scope: "details",
      value: "",
      linkTitleFor: () => "Cmd+click to open",
      resolveAsset: (ref) => `vesta-asset://${ref}`,
    });
    open.push(editor);
    paste(editor.view, `[f](${FILE}) [w](https://example.com) ![p](${IMAGE})`);
    expect(editor.getMarkdown()).toBe(`[f](${FILE}) [w](https://example.com) ![p](${IMAGE})`);
    expect(host.querySelector("a")?.getAttribute("href")).toBe(`vesta-asset://${FILE}`);
    expect(host.querySelector("a")?.getAttribute("title")).toBe("Cmd+click to open");
  });

  it("an empty editor stores an empty string", async () => {
    for (const scope of ["title", "details"] as const) {
      const editor = await mount(scope);
      expect(editor.getMarkdown()).toBe("");
      type(editor.view, "x");
      editor.view.dispatch(editor.view.state.tr.delete(1, 2));
      expect(editor.getMarkdown()).toBe("");
    }
  });
});

// 012 FR-035: the new formats round-trip unchanged (constitution III).
describe("012 FR-035 round-trips", () => {
  const cases: [string, string][] = [
    ["FR-035 checklist items made from paragraphs", "- [ ] a\n- [x] b"],
    ["FR-035 nested items made by Indent, bulleted", "- one\n  - [ ] two\n    - three"],
    ["FR-035 nested items made by Indent, numbered", "1. one\n   1. [x] two"],
    ["FR-035 checklist removed keeps the list", "- a\n- b"],
    ...["0.75em", "0.875em", "1.25em", "1.5em", "2em", "2.5em"].map((size): [string, string] => [`FR-035 the ladder size ${size}`, `[x]{size="${size}"} y`]),
    ["FR-035 a ladder size combined with color and underline", '[x]{color="#dd3333ff" size="1.5em" .underline} y'],
    ["FR-035 text after Remove color keeps its size", '[x]{size="1.25em"} y'],
    ["FR-035 text after Remove highlight keeps its underline", "[x]{.underline} y"],
    ["FR-035 text after Remove color and Remove highlight is plain", "x y"],
  ];
  it.each(cases)("%s", async (_name, md) => {
    const e = await mount("details", md);
    expect(e.getMarkdown()).toBe(md);
    // Edited blocks are written canonically: an edit elsewhere leaves this text as it is.
    e.view.dispatch(e.view.state.tr.insertText("x", Selection.atEnd(e.view.state.doc).from));
    expect(e.getMarkdown()).toBe(`${md}x`);
  });
});

// 012 FR-005, FR-005b (PRD Q150): one Enter starts a paragraph; Shift+Enter is a line break; empty paragraphs are not stored.
describe("012 FR-005 paragraphs and line breaks", () => {
  const press = (view: EditorView, key: string, shiftKey = false) =>
    view.someProp("handleKeyDown", (f) => f(view, new KeyboardEvent("keydown", { key, shiftKey }))) ?? false;

  it("FR-005 Enter at the end of a paragraph, then text: two paragraphs, one blank line in the markdown", async () => {
    const e = await mount("details", "first");
    e.view.dispatch(e.view.state.tr.setSelection(Selection.atEnd(e.view.state.doc)));
    expect(press(e.view, "Enter")).toBe(true);
    type(e.view, "second");
    expect(e.getMarkdown()).toBe("first\n\nsecond");
  });

  it("FR-005 Shift+Enter: one paragraph with a markdown line break", async () => {
    const e = await mount("details", "first");
    e.view.dispatch(e.view.state.tr.setSelection(Selection.atEnd(e.view.state.doc)));
    expect(press(e.view, "Enter", true)).toBe(true);
    type(e.view, "second");
    expect(e.view.state.doc.childCount).toBe(1);
    expect(e.getMarkdown()).toMatch(/^first(\\| {2})\nsecond$/);
  });

  it("FR-005b Enter twice adds an empty paragraph while editing; it is not stored", async () => {
    const e = await mount("details", "first");
    e.view.dispatch(e.view.state.tr.setSelection(Selection.atEnd(e.view.state.doc)));
    press(e.view, "Enter");
    press(e.view, "Enter");
    type(e.view, "second");
    expect(e.view.state.doc.childCount).toBe(3);
    expect(e.getMarkdown()).toBe("first\n\nsecond");
  });
});
