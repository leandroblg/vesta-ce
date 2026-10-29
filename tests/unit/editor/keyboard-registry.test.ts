/** 007 research §10: one registry dispatches every shortcut by action kind and view (happy-dom). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installRegistry, isClose, registerHandler, registerListRedo } from "../../../src/renderer/keyboard/registry";
import { useVesta } from "../../../src/renderer/store/store";
import { TextSelection } from "@milkdown/kit/prose/state";

const press = (target: EventTarget, key: string, code: string, mods: Partial<KeyboardEventInit> = {}) => {
  const e = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...mods });
  target.dispatchEvent(e);
  return e;
};

describe("shortcut registry", () => {
  let uninstall: () => void;
  const offs: (() => void)[] = [];
  beforeEach(() => {
    useVesta.setState({ isMac: false, shortcuts: {}, settingsOpen: false, overrideFor: null, menuFor: null, drag: null, view: "tasks", capture: null });
    uninstall = installRegistry();
  });
  afterEach(() => {
    uninstall();
    for (const f of offs.splice(0)) f();
    document.body.replaceChildren();
  });

  it("runs a global action from anywhere, also from a text field, and prevents the key", () => {
    const fn = vi.fn(() => true);
    offs.push(registerHandler("search", fn));
    const input = document.body.appendChild(document.createElement("input"));
    const e = press(input, "f", "KeyF", { ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("follows a remapped combination", () => {
    const fn = vi.fn(() => true);
    offs.push(registerHandler("search", fn));
    useVesta.setState({ shortcuts: { search: ["F9"] } });
    press(document.body, "f", "KeyF", { ctrlKey: true });
    expect(fn).not.toHaveBeenCalled();
    press(document.body, "F9", "F9");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("never runs a selection action while text is edited, or while Settings is open", () => {
    const fn = vi.fn(() => true);
    offs.push(registerHandler("down", fn));
    const input = document.body.appendChild(document.createElement("input"));
    press(input, "ArrowDown", "ArrowDown");
    expect(fn).not.toHaveBeenCalled();
    useVesta.setState({ settingsOpen: true });
    press(document.body, "ArrowDown", "ArrowDown");
    expect(fn).not.toHaveBeenCalled();
    useVesta.setState({ settingsOpen: false });
    press(document.body, "ArrowDown", "ArrowDown");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("lets Minimize window work while Settings is open, and no other global action (FR-022)", () => {
    const min = vi.fn(() => true);
    const settings = vi.fn(() => true);
    offs.push(registerHandler("minimize", min), registerHandler("settings", settings));
    useVesta.setState({ settingsOpen: true, shortcuts: { minimize: ["Mod+M"] } });
    press(document.body, "m", "KeyM", { ctrlKey: true });
    press(document.body, ",", "Comma", { ctrlKey: true });
    expect(min).toHaveBeenCalledTimes(1);
    expect(settings).not.toHaveBeenCalled();
  });

  it("picks the action of the current view: Enter opens on the main view and in the Archive; Shift+Enter restores there (011 FR-022b)", () => {
    const open = vi.fn(() => true);
    const restore = vi.fn(() => true);
    offs.push(registerHandler("open", open), registerHandler("restore", restore));
    press(document.body, "Enter", "Enter");
    useVesta.setState({ view: "archive" });
    press(document.body, "Enter", "Enter");
    press(document.body, "Enter", "Enter", { shiftKey: true });
    expect(open).toHaveBeenCalledTimes(2);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("keeps a key's native action when the handler does not use it", () => {
    offs.push(registerHandler("down", () => false));
    expect(press(document.body, "ArrowDown", "ArrowDown").defaultPrevented).toBe(false);
  });

  it("turns Mod+Z into text undo in a text field, whatever it is mapped to (FR-022, analysis U3)", () => {
    const newTask = vi.fn(() => true);
    offs.push(registerHandler("newTask", newTask));
    useVesta.setState({ shortcuts: { undo: ["Mod+U"], newTask: ["Mod+Z"] } });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    const input = document.body.appendChild(document.createElement("input"));
    const e = press(input, "z", "KeyZ", { ctrlKey: true });
    expect(exec).toHaveBeenCalledWith("undo");
    expect(e.defaultPrevented).toBe(true);
    expect(newTask).not.toHaveBeenCalled();
    press(document.body, "z", "KeyZ", { ctrlKey: true });
    expect(newTask).toHaveBeenCalledTimes(1);
  });

  it("016 FR-007 Mod+Shift+Z redoes an undone reschedule outside text fields only", () => {
    const listRedo = vi.fn(() => true);
    offs.push(registerListRedo(listRedo));
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    const e = press(document.body, "z", "KeyZ", { ctrlKey: true, shiftKey: true });
    expect(listRedo).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    const input = document.body.appendChild(document.createElement("input"));
    press(input, "z", "KeyZ", { ctrlKey: true, shiftKey: true });
    expect(exec).toHaveBeenCalledWith("redo");
    expect(listRedo).toHaveBeenCalledTimes(1);
    useVesta.setState({ settingsOpen: true });
    press(document.body, "z", "KeyZ", { ctrlKey: true, shiftKey: true });
    expect(listRedo).toHaveBeenCalledTimes(1);
  });

  it("016 Mod+Shift+Z keeps its native action when there is nothing to redo", () => {
    offs.push(registerListRedo(() => false));
    expect(press(document.body, "z", "KeyZ", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
  });

  it("016 Mod+Shift+Z mapped to another action runs it when there is nothing to redo (007 remap)", () => {
    offs.push(registerListRedo(() => false));
    const settings = vi.fn(() => true);
    offs.push(registerHandler("settings", settings));
    useVesta.setState({ shortcuts: { settings: ["Mod+Shift+Z"] } });
    press(document.body, "z", "KeyZ", { ctrlKey: true, shiftKey: true });
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it("answers isClose from the map (FR-032)", () => {
    const esc = { key: "Escape", code: "Escape", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
    expect(isClose(esc)).toBe(true);
    useVesta.setState({ shortcuts: { close: ["F9"] } });
    expect(isClose(esc)).toBe(false);
    expect(isClose({ ...esc, key: "F9", code: "F9" })).toBe(true);
  });

  it("ignores keys while a shortcut is captured", () => {
    const fn = vi.fn(() => true);
    offs.push(registerHandler("down", fn));
    useVesta.setState({ capture: { action: "newTask" } });
    press(document.body, "ArrowDown", "ArrowDown");
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("011 the picker, the size grid and the menu own their keys", () => {
  it("FR-011 FR-019 keys in .cpick, .tsize and .fmenu count as editing, so list shortcuts stay out", async () => {
    const { inEditor } = await import("../../../src/renderer/keyboard/editing");
    for (const cls of ["cpick", "tsize", "fmenu"]) {
      const box = document.createElement("div");
      box.className = cls;
      const button = document.createElement("button");
      box.append(button);
      document.body.append(box);
      expect(inEditor(button), cls).toBe(true);
      box.remove();
    }
    const plain = document.createElement("button");
    document.body.append(plain);
    expect(inEditor(plain)).toBe(false);
    plain.remove();
  });
});

// 012 FR-009 (PRD Q161): the indent keys act only in the details editor, follow a remap, and Tab moves the focus.
describe("012 FR-009 the indent keys", () => {
  let uninstall: () => void;
  const offs: (() => void)[] = [];
  const editors: { destroy(): void }[] = [];
  beforeEach(() => {
    useVesta.setState({ isMac: false, shortcuts: {}, settingsOpen: false, overrideFor: null, menuFor: null, drag: null, view: "tasks", capture: null });
    uninstall = installRegistry();
  });
  afterEach(() => {
    uninstall();
    for (const f of offs.splice(0)) f();
    for (const e of editors.splice(0)) e.destroy();
    document.body.replaceChildren();
  });

  async function mountEditor(scope: "details" | "title", value: string) {
    const { createEditor } = await import("../../../src/renderer/editor/create-editor");
    const host = document.body.appendChild(document.createElement("div"));
    const editor = await createEditor(host, { scope, value });
    editors.push(editor);
    editor.view.focus();
    return editor;
  }

  it("FR-009 Mod+] in a details list item indents through the editor action; not in a title or outside an editor", async () => {
    const fn = vi.fn(() => true);
    offs.push(registerHandler("indentItem", fn));
    const details = await mountEditor("details", "- one\n- two");
    press(details.view.dom, "]", "BracketRight", { ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
    const title = await mountEditor("title", "a title");
    press(title.view.dom, "]", "BracketRight", { ctrlKey: true });
    press(document.body, "]", "BracketRight", { ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("FR-009 a remapped combination works and the default no longer does", async () => {
    const fn = vi.fn(() => true);
    offs.push(registerHandler("outdentItem", fn));
    useVesta.setState({ shortcuts: { outdentItem: ["Alt+ArrowLeft"] } });
    const details = await mountEditor("details", "- one\n  - two");
    press(details.view.dom, "[", "BracketLeft", { ctrlKey: true });
    expect(fn).not.toHaveBeenCalled();
    press(details.view.dom, "ArrowLeft", "ArrowLeft", { altKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("FR-009 the details editor's indent and outdent change the list, one Undo step each", async () => {
    const { activeEditor } = await import("../../../src/renderer/editor/active");
    const details = await mountEditor("details", "- one\n- two");
    const end = details.view.state.doc.content.size - 3;
    details.view.dispatch(details.view.state.tr.setSelection(TextSelection.create(details.view.state.doc, end)));
    expect(activeEditor()?.scope).toBe("details");
    expect(activeEditor()?.indent(1)).toBe(true);
    expect(details.getMarkdown()).toBe("- one\n  - two");
    expect(activeEditor()?.indent(-1)).toBe(true);
    expect(details.getMarkdown()).toBe("- one\n- two");
  });

  it("FR-009 Tab and Shift+Tab are not consumed in a list item; Enter still splits it", async () => {
    const details = await mountEditor("details", "- one\n- two");
    const end = details.view.state.doc.content.size - 3;
    details.view.dispatch(details.view.state.tr.setSelection(TextSelection.create(details.view.state.doc, end)));
    const handled = (key: string, shiftKey = false) =>
      details.view.someProp("handleKeyDown", (f) => f(details.view, new KeyboardEvent("keydown", { key, shiftKey }))) ?? false;
    expect(handled("Tab")).toBe(false);
    expect(handled("Tab", true)).toBe(false);
    expect(details.getMarkdown()).toBe("- one\n- two");
    expect(handled("Enter")).toBe(true);
  });
});

describe("013 FR-048 the menu commands' keys in the registry (T096, T056)", () => {
  let uninstall: () => void;
  const offs: (() => void)[] = [];
  beforeEach(() => {
    useVesta.setState({ isMac: false, shortcuts: {}, settingsOpen: false, aboutOpen: false, overrideFor: null, menuFor: null, drag: null, view: "tasks", capture: null });
    uninstall = installRegistry();
  });
  afterEach(() => {
    uninstall();
    for (const f of offs.splice(0)) f();
    document.body.replaceChildren();
  });

  it("FR-048 Mod+2 runs View › Archive, from the list and from a text field", () => {
    const fn = vi.fn(() => true);
    offs.push(registerHandler("view:archive", fn));
    press(document.body, "2", "Digit2", { ctrlKey: true });
    const input = document.body.appendChild(document.createElement("input"));
    press(input, "2", "Digit2", { ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("PRD Q187 Delete is Move to Trash in the main view and Delete Permanently in the Trash; Shift+Delete only in the Trash", () => {
    const del = vi.fn(() => true);
    const forever = vi.fn(() => true);
    offs.push(registerHandler("del", del), registerHandler("deleteForever", forever));
    press(document.body, "Delete", "Delete");
    expect([del.mock.calls.length, forever.mock.calls.length]).toEqual([1, 0]);
    press(document.body, "Delete", "Delete", { shiftKey: true });
    expect(forever).not.toHaveBeenCalled();
    useVesta.setState({ view: "trash" });
    press(document.body, "Delete", "Delete");
    press(document.body, "Delete", "Delete", { shiftKey: true });
    expect([del.mock.calls.length, forever.mock.calls.length]).toEqual([1, 2]);
  });

  it("FR-048 an assigned Underline key runs in a title editor and does nothing outside an editor", async () => {
    const { registerEditor } = await import("../../../src/renderer/editor/active");
    const fn = vi.fn(() => true);
    offs.push(registerHandler("fmt:underline", fn));
    useVesta.setState({ shortcuts: { "fmt:underline": ["Mod+Alt+U"] } });
    press(document.body, "u", "KeyU", { ctrlKey: true, altKey: true });
    expect(fn).not.toHaveBeenCalled();
    const host = document.body.appendChild(document.createElement("div"));
    offs.push(
      registerEditor({ scope: "title", hasFocus: () => true, contains: (n) => host.contains(n), indent: () => false, undo: () => false, redo: () => false }),
    );
    press(host, "u", "KeyU", { ctrlKey: true, altKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("FR-019 Q183 no shortcut acts while About is open; Minimize window still does", () => {
    const view = vi.fn(() => true);
    const settings = vi.fn(() => true);
    const min = vi.fn(() => true);
    offs.push(registerHandler("view:archive", view), registerHandler("settings", settings), registerHandler("minimize", min));
    useVesta.setState({ aboutOpen: true, shortcuts: { minimize: ["Mod+M"] } });
    press(document.body, "2", "Digit2", { ctrlKey: true });
    press(document.body, ",", "Comma", { ctrlKey: true });
    press(document.body, "m", "KeyM", { ctrlKey: true });
    expect([view.mock.calls.length, settings.mock.calls.length, min.mock.calls.length]).toEqual([0, 0, 1]);
  });
});

describe("013 T062 the indent keys from the editor's own floating menu", () => {
  it("Mod+] with the focus on a menu button of the details editor runs Indent", async () => {
    const { registerEditor } = await import("../../../src/renderer/editor/active");
    useVesta.setState({ isMac: false, shortcuts: {}, settingsOpen: false, aboutOpen: false, view: "tasks", capture: null });
    const uninstall = installRegistry();
    const editorHost = document.body.appendChild(document.createElement("div"));
    const menuHost = document.body.appendChild(document.createElement("div"));
    const button = menuHost.appendChild(document.createElement("button"));
    const fn = vi.fn(() => true);
    const offs = [
      registerHandler("indentItem", fn),
      registerEditor({
        scope: "details",
        hasFocus: () => false,
        contains: (n) => editorHost.contains(n),
        menuContains: (n) => menuHost.contains(n),
        indent: () => true,
        undo: () => false,
        redo: () => false,
      }),
    ];
    press(button, "]", "BracketRight", { ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
    for (const f of offs) f();
    uninstall();
    document.body.replaceChildren();
  });
});
