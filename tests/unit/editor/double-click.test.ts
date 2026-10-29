// 012 US5: a double click inside highlighted text selects exactly that highlighted run (FR-018, FR-019, research §7).
import { afterEach, describe, expect, it } from "vitest";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createEditor, type EditorHandle } from "../../../src/renderer/editor/create-editor";
import { pressedStates, toggleHighlight } from "../../../src/renderer/editor/menu/block-toggles";

const open: EditorHandle[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

async function mount(value: string): Promise<EditorHandle> {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = await createEditor(host, { scope: "details", value });
  open.push(editor);
  return editor;
}

function posOf(view: EditorView, text: string): number {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    const i = node.isText ? (node.text?.indexOf(text) ?? -1) : -1;
    if (i >= 0) at = pos + i;
    return true;
  });
  if (at < 0) throw new Error(text);
  return at;
}

/** Runs the editor's double-click handlers at the position just inside `text`; true when one handled it. */
function doubleClick(view: EditorView, text: string): boolean {
  const pos = posOf(view, text) + 1;
  return view.someProp("handleDoubleClick", (f) => f(view, pos, new MouseEvent("dblclick"))) ?? false;
}

const selected = (view: EditorView) => view.state.doc.textBetween(view.state.selection.from, view.state.selection.to);

describe("012 FR-018 double click on a highlight", () => {
  it("FR-018 a default highlight: the whole run, across words", async () => {
    const e = await mount("a ==two words== b");
    expect(doubleClick(e.view, "words")).toBe(true);
    expect(selected(e.view)).toBe("two words");
  });

  it("FR-018 a colored highlight: the whole run", async () => {
    const e = await mount('x [y z]{bg="#ffe066ff"} w');
    expect(doubleClick(e.view, "z")).toBe(true);
    expect(selected(e.view)).toBe("y z");
  });

  it("FR-018 a highlight spanning a link and bold text is selected whole", async () => {
    const e = await mount("start ==plain **bold** [link](https://example.com) end== after");
    expect(doubleClick(e.view, "bold")).toBe(true);
    expect(selected(e.view)).toBe("plain bold link end");
  });

  it("Edge Cases two adjacent runs with different colors are two runs", async () => {
    const e = await mount('[one]{bg="#ffe066ff"}[two]{bg="#bbf7d0ff"}');
    expect(doubleClick(e.view, "two")).toBe(true);
    expect(selected(e.view)).toBe("two");
  });

  it("FR-018 text color alone and plain text keep the usual word selection", async () => {
    const e = await mount('[red text]{color="#dd3333ff"} plain words');
    expect(doubleClick(e.view, "text")).toBe(false);
    expect(doubleClick(e.view, "words")).toBe(false);
  });

  it("FR-019 Highlight shows pressed on the run and removes it", async () => {
    const e = await mount("a ==two words== b");
    doubleClick(e.view, "two");
    expect(pressedStates(e.view.state).highlight).toBe(true);
    toggleHighlight(e.view, "details");
    expect(e.getMarkdown()).toBe("a two words b");
  });
});
