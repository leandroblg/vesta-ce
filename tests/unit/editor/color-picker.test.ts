// 011 US2: the color picker on a mounted editor (FR-008 to FR-014, contracts/ui.md).
import { afterEach, describe, expect, it } from "vitest";
import { TextSelection } from "@milkdown/kit/prose/state";
import { undoDepth } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createEditor, type EditorHandle } from "../../../src/renderer/editor/create-editor";
import { currentColor, dropIndex, memoryPort, type ColorListsPort } from "../../../src/renderer/editor/menu/color-picker";

const open: EditorHandle[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

async function mount(value: string, port: ColorListsPort = memoryPort()): Promise<EditorHandle> {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = await createEditor(host, { scope: "details", value, colors: port });
  open.push(editor);
  return editor;
}

function select(view: EditorView, text: string): void {
  const hits: { from: number; to: number }[] = [];
  view.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text?.indexOf(text) ?? -1) : -1;
    if (at >= 0) hits.push({ from: pos + at, to: pos + at + text.length });
  });
  const range = hits[0];
  if (range === undefined) throw new Error(text);
  const { from, to } = range;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
}

const picker = () => document.querySelector<HTMLElement>(".cpick") as HTMLElement;
const menuButton = (id: string) => document.querySelector<HTMLButtonElement>(`.fmenu button[data-cmd="${id}"]`) as HTMLButtonElement;
const swatch = (section: string, hex: string) => picker().querySelector<HTMLElement>(`[data-section="${section}"][data-hex="${hex}"]`) as HTMLElement;
const key = (target: HTMLElement, k: string, extra: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }));
/** 013 FR-042: the highlight picker opens from the one Highlight button (Shift+Enter; a long press does the same). */
const openHighlightPicker = () => {
  const mark = menuButton("mark");
  mark.focus();
  key(mark, "Enter", { shiftKey: true });
};

/** 016 FR-021: the text color picker opens on Shift+Enter (or a hold); a click applies the swatch. */
const openTextPicker = () => {
  const color = menuButton("color");
  color.focus();
  key(color, "Enter", { shiftKey: true });
};

describe("FR-008 FR-014 the picker", () => {
  it("FR-014 Text color and Highlight (013: its Shift+Enter) open the same picker over the same lists", async () => {
    const port = memoryPort({ pinned: ["#123456ff"], recent: [] });
    const e = await mount("text", port);
    select(e.view, "text");
    openTextPicker();
    expect(picker().hidden).toBe(false);
    expect(picker().getAttribute("aria-label")).toBe("Text color");
    expect(swatch("pinned", "#123456ff")).not.toBeNull();
    key(picker(), "Escape");
    openHighlightPicker();
    expect(picker().getAttribute("aria-label")).toBe("Highlight color");
    expect(swatch("pinned", "#123456ff")).not.toBeNull();
    expect(document.querySelectorAll(".cpick")).toHaveLength(1);
  });

  it("FR-008 US2-1 sections in order: Remove color, 100 presets, 10 pinned slots, 20 recent slots, Custom color…", async () => {
    const e = await mount("text");
    select(e.view, "text");
    openTextPicker();
    const order = Array.from(picker().querySelectorAll<HTMLElement>("[data-section]"))
      .filter((n) => n.parentElement === picker())
      .map((n) => n.dataset.section);
    expect(order).toEqual(["auto", "preset", "pinned", "recent", "custom"]);
    expect(picker().querySelectorAll('[data-section="preset"] [role="gridcell"]')).toHaveLength(100);
    expect(picker().querySelectorAll('[data-section="preset"] [role="row"]')).toHaveLength(10);
    expect(picker().querySelectorAll(".cp-pinned > *")).toHaveLength(10);
    expect(picker().querySelectorAll(".cp-recent > *")).toHaveLength(20);
    expect(swatch("preset", "#ef4444ff").getAttribute("aria-label")).toBe("Red 500");
    expect(swatch("preset", "#ffffffff").getAttribute("aria-label")).toBe("White");
    expect(swatch("preset", "#d1d5dbff").getAttribute("aria-label")).toBe("Gray 300");
    expect(picker().querySelector(".cp-empty")?.textContent).toBe("Colors you pick show here");
  });

  // 012 FR-020 to FR-022 (PRD Q154) replace "Automatic": the first choice says what it removes, and does it.
  it("FR-020 Remove color removes the text color and stores no attribute; FR-021 Remove highlight removes ==…== and bg alike", async () => {
    const e = await mount('[a]{color="#dd3333ff"} ==[b]{bg="#ffe066ff"}== ==c==');
    select(e.view, "a");
    openTextPicker();
    const first = () => picker().querySelector('[data-section="auto"]') as HTMLElement;
    expect(first().textContent).toBe("Remove color");
    first().click();
    expect(e.getMarkdown()).toBe('a [==b==]{bg="#ffe066ff"} ==c==');
    select(e.view, "b");
    openHighlightPicker();
    expect(first().textContent).toBe("Remove highlight");
    first().click();
    expect(e.getMarkdown()).toBe("a b ==c==");
    select(e.view, "c");
    openHighlightPicker();
    first().click();
    expect(e.getMarkdown()).toBe("a b c");
  });

  it("FR-022 the first choice is always enabled, current when there is nothing to remove, records no step then, and adds no recent color", async () => {
    const port = memoryPort();
    const e = await mount("plain ==lit==", port);
    select(e.view, "lit");
    openHighlightPicker();
    const first = () => picker().querySelector('[data-section="auto"]') as HTMLElement;
    expect(first().getAttribute("aria-current")).toBeNull();
    expect(first().hasAttribute("disabled")).toBe(false);
    key(picker(), "Escape");
    select(e.view, "plain");
    openHighlightPicker();
    expect(first().getAttribute("aria-current")).toBe("true");
    const before = e.view.state;
    first().click();
    expect(e.view.state.doc.eq(before.doc)).toBe(true);
    expect(undoDepth(e.view.state)).toBe(undoDepth(before));
    expect(port.get().recent).toEqual([]);
  });

  it("FR-010 US2-3 a preset stores its 8-digit value and leaves recent unchanged; the picker closes", async () => {
    const port = memoryPort();
    const e = await mount("text", port);
    select(e.view, "text");
    openTextPicker();
    swatch("preset", "#2563ebff").click();
    expect(e.getMarkdown()).toBe('[text]{color="#2563ebff"}');
    expect(port.get().recent).toEqual([]);
    expect(picker().hidden).toBe(true);
  });

  it("US2-4 US2-5 a custom color applies and goes first in recent; FR-013 currentColor is null for a mixed range", async () => {
    const port = memoryPort({ pinned: [], recent: ["#000001ff"] });
    const e = await mount('[a]{color="#dd3333ff"} b', port);
    select(e.view, "a");
    expect(currentColor(e.view, "color")).toBe("#dd3333ff");
    select(e.view, "a] b".slice(0, 1));
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 1, e.view.state.doc.content.size - 1)));
    expect(currentColor(e.view, "color")).toBeNull();
    openTextPicker();
    const input = picker().querySelector<HTMLInputElement>("input[type='color']") as HTMLInputElement;
    input.value = "#336699";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(e.getMarkdown()).toBe('[a b]{color="#336699ff"}');
    expect(port.get().recent).toEqual(["#336699ff", "#000001ff"]);
  });

  it("US2-12 the current color is marked; arrows move, Tab sections, Enter chooses, Esc closes back to the button", async () => {
    const e = await mount('[t]{color="#ef4444ff"}');
    select(e.view, "t");
    openTextPicker();
    const current = swatch("preset", "#ef4444ff");
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(document.activeElement).toBe(current);
    key(current, "ArrowRight");
    expect(document.activeElement).toBe(swatch("preset", "#f97316ff"));
    key(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(swatch("preset", "#ea580cff"));
    key(document.activeElement as HTMLElement, "Escape");
    expect(picker().hidden).toBe(true);
    expect(document.activeElement).toBe(menuButton("color"));
    openTextPicker();
    key(document.activeElement as HTMLElement, "ArrowRight");
    key(document.activeElement as HTMLElement, "Enter");
    expect(e.getMarkdown()).toBe('[t]{color="#f97316ff"}');
  });

  it("US2-6 to US2-9 Shift+Enter pins first, Alt+Arrows reorder, Delete unpins; the picker stays open", async () => {
    const port = memoryPort({ pinned: ["#000001ff"], recent: ["#000002ff"] });
    const e = await mount("t", port);
    select(e.view, "t");
    openTextPicker();
    key(swatch("recent", "#000002ff"), "Enter", { shiftKey: true });
    expect(port.get()).toEqual({ pinned: ["#000002ff", "#000001ff"], recent: [] });
    key(swatch("preset", "#ef4444ff"), "Enter", { shiftKey: true });
    expect(port.get().pinned).toEqual(["#ef4444ff", "#000002ff", "#000001ff"]);
    key(swatch("pinned", "#000001ff"), "Enter", { shiftKey: true });
    expect(port.get().pinned[0]).toBe("#000001ff");
    key(swatch("pinned", "#000001ff"), "ArrowRight", { altKey: true });
    expect(port.get().pinned).toEqual(["#ef4444ff", "#000001ff", "#000002ff"]);
    key(swatch("pinned", "#000002ff"), "Delete");
    expect(port.get()).toEqual({ pinned: ["#ef4444ff", "#000001ff"], recent: [] });
    key(picker().querySelector('[data-section="auto"]') as HTMLElement, "Enter", { shiftKey: true });
    expect(port.get().pinned).toEqual(["#ef4444ff", "#000001ff"]);
    expect(picker().hidden).toBe(false);
  });

  it("US2-6, 016 FR-028 a drop on the pinned row pins where it lands; a drop elsewhere changes nothing", async () => {
    const port = memoryPort({ pinned: ["#000001ff"], recent: [] });
    const e = await mount("t", port);
    select(e.view, "t");
    openTextPicker();
    const data = new Map<string, string>();
    const transfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? "",
      get types() {
        return [...data.keys()];
      },
      effectAllowed: "",
    };
    const drag = (target: HTMLElement, type: string) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: transfer });
      target.dispatchEvent(ev);
    };
    drag(swatch("preset", "#ef4444ff"), "dragstart");
    drag(picker().querySelector<HTMLElement>('[data-section="recent"]') as HTMLElement, "drop");
    expect(port.get().pinned).toEqual(["#000001ff"]);
    // The one pinned swatch spans 100–120: a drop left of its middle lands before it.
    const only = swatch("pinned", "#000001ff");
    only.getBoundingClientRect = () => ({ left: 100, width: 20, right: 120, top: 0, bottom: 20, height: 20, x: 100, y: 0, toJSON: () => ({}) });
    const dropAt = (target: HTMLElement, x: number) => {
      const ev = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: transfer });
      Object.defineProperty(ev, "clientX", { value: x });
      target.dispatchEvent(ev);
    };
    dropAt(only, 105);
    expect(port.get().pinned).toEqual(["#ef4444ff", "#000001ff"]);
  });

  it("016 FR-028 a recent color dropped between the 3rd and 4th pinned lands 4th and leaves the recent row; with ten pinned the rightmost goes", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `#0000${(i + 1).toString(16).padStart(2, "0")}ff`);
    const port = memoryPort({ pinned: ten, recent: ["#abcdefff"] });
    const e = await mount("t", port);
    select(e.view, "t");
    openTextPicker();
    const data = new Map<string, string>();
    const transfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", get types() { return [...data.keys()]; }, effectAllowed: "" };
    const fire = (target: HTMLElement, type: string, x?: number) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: transfer });
      if (x !== undefined) Object.defineProperty(ev, "clientX", { value: x });
      target.dispatchEvent(ev);
    };
    // Swatches 24 px wide with 4 px gaps, from x = 10.
    picker().querySelectorAll<HTMLElement>('[data-section="pinned"][data-hex]').forEach((sw, i) => {
      const left = 10 + i * 28;
      sw.getBoundingClientRect = () => ({ left, width: 24, right: left + 24, top: 0, bottom: 24, height: 24, x: left, y: 0, toJSON: () => ({}) });
    });
    fire(swatch("recent", "#abcdefff"), "dragstart");
    // The gap between the 3rd (66–90) and the 4th (94–118).
    fire(picker().querySelector<HTMLElement>(".cp-pinned") as HTMLElement, "drop", 92);
    expect(port.get().pinned[3]).toBe("#abcdefff");
    expect(port.get().pinned).toHaveLength(10);
    expect(port.get().pinned).not.toContain(ten[9]);
    expect(port.get().recent).not.toContain("#abcdefff");
  });

  it("FR-009 the adjusted mark: gray 100 in the text picker; gray 800 in the highlight picker (light theme)", async () => {
    const e = await mount("t");
    select(e.view, "t");
    openTextPicker();
    expect(swatch("preset", "#f3f4f6ff").querySelector(".cp-adjusted")).not.toBeNull();
    expect(swatch("preset", "#f3f4f6ff").getAttribute("aria-description")).toBe("Adjusted for contrast in this theme");
    expect(swatch("preset", "#1f2937ff").querySelector(".cp-adjusted")).toBeNull();
    key(picker(), "Escape");
    openHighlightPicker();
    expect(swatch("preset", "#fef3c7ff").querySelector(".cp-adjusted")).not.toBeNull();
  });
});

describe("012 Edge Cases a color in an empty paragraph", () => {
  it("a color chosen in an empty paragraph applies to the next typed text", async () => {
    const e = await mount("first");
    const end = e.view.state.doc.content.size;
    const paragraph = e.view.state.schema.nodes["paragraph"];
    if (!paragraph) throw new Error("no paragraph");
    const tr = e.view.state.tr.insert(end, paragraph.create());
    e.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)));
    openTextPicker();
    swatch("preset", "#2563ebff").click();
    e.view.dispatch(e.view.state.tr.insertText("blue"));
    expect(e.getMarkdown()).toBe('first\n\n[blue]{color="#2563ebff"}');
  });
});

describe("016 FR-028 dropIndex (PRD Q223)", () => {
  const boxes = [0, 1, 2].map((i) => ({ left: 10 + i * 28, width: 24 }));
  it("before or after a swatch by its middle; a gap or padding to the nearest gap; past the end or an empty row, last", () => {
    expect(dropIndex(15, boxes)).toBe(0);
    expect(dropIndex(30, boxes)).toBe(1);
    expect(dropIndex(36, boxes)).toBe(1);
    expect(dropIndex(0, boxes)).toBe(0);
    expect(dropIndex(500, boxes)).toBe(3);
    expect(dropIndex(5, [])).toBe(0);
  });
});
