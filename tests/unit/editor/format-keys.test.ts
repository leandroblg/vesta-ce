// 013 T045 (research §5): every accelerator the Format menu shows is a key the editor itself handles.
import { afterEach, describe, expect, it } from "vitest";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { MENU_COMMANDS } from "../../../src/domain/menu/commands";
import { createEditor, type EditorHandle } from "../../../src/renderer/editor/create-editor";

const open: EditorHandle[] = [];
afterEach(() => {
  for (const e of open.splice(0)) e.destroy();
  document.body.innerHTML = "";
});

async function mount(value: string): Promise<EditorHandle> {
  const host = document.createElement("div");
  document.body.append(host);
  const e = await createEditor(host, { scope: "details", value });
  open.push(e);
  return e;
}

/** Presses a Vesta combination (Mod = Ctrl in happy-dom) through the editor's own key handling. */
function press(view: EditorView, combo: string): boolean {
  const parts = combo.split("+");
  const key = parts.at(-1) ?? "";
  const mac = /Mac/.test(navigator.platform);
  const event = new KeyboardEvent("keydown", {
    key: key.length === 1 ? key.toLowerCase() : key,
    code: /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`,
    ctrlKey: parts.includes("Mod") && !mac,
    metaKey: parts.includes("Mod") && mac,
    altKey: parts.includes("Alt"),
    shiftKey: parts.includes("Shift"),
    bubbles: true,
  });
  return view.someProp("handleKeyDown", (f) => f(view, event)) === true;
}

function selectAll(view: EditorView): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)));
}

const EXPECT: Record<string, (md: string) => boolean> = {
  "fmt:strong": (md) => md === "**text**",
  "fmt:emphasis": (md) => md === "*text*" || md === "_text_",
  "fmt:inlineCode": (md) => md === "`text`",
  "fmt:strike_through": (md) => md === "~~text~~",
  "fmt:heading-1": (md) => md === "# text",
  "fmt:heading-3": (md) => md === "### text",
  "fmt:bullet": (md) => /^[-*] text$/.test(md),
  "fmt:ordered": (md) => md === "1. text",
  "fmt:quote": (md) => md === "> text",
  "fmt:codeblock": (md) => md.startsWith("```"),
};

describe("013 FR-013 the Format menu's editor keys", () => {
  it.each(Object.keys(EXPECT))("%s: its accelerator does it in the editor", async (id) => {
    const accel = MENU_COMMANDS.find((c) => c.id === id)?.accel;
    expect(accel, id).toBeTypeOf("string");
    const e = await mount("text");
    selectAll(e.view);
    expect(press(e.view, accel as string), `${id} ${String(accel)}`).toBe(true);
    expect(EXPECT[id]?.(e.getMarkdown()), `${id}: ${e.getMarkdown()}`).toBe(true);
  });
});
