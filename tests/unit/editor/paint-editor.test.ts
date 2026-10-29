// 011 FR-009: a theme switch repaints the spans of an open editor without changing its document.
import { afterEach, describe, expect, it } from "vitest";
import { createEditor, type EditorHandle } from "../../../src/renderer/editor/create-editor";
import { paintAll } from "../../../src/renderer/markdown/paint";

const open: EditorHandle[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

describe("FR-009 painting in the editor", () => {
  it("FR-009 switching theme repaints spans in an open editor; its document does not change", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const md = '[pale]{color="#f3f4f6ff"} and [dark]{bg="#1f2937ff"}';
    const editor = await createEditor(host, { scope: "details", value: md });
    open.push(editor);
    const pale = host.querySelector<HTMLElement>('[data-color="#f3f4f6ff"]');
    const before = editor.view.state.doc;
    paintAll(document.body, "light");
    const lightColor = pale?.style.color;
    paintAll(document.body, "dark");
    expect(pale?.style.color).not.toBe(lightColor);
    await new Promise((r) => setTimeout(r, 50));
    expect(editor.view.state.doc.eq(before)).toBe(true);
    expect(editor.getMarkdown()).toBe(md);
  });
});
