// 011 US3: Table click, long press, size grid and fields on a mounted details editor (FR-018 to FR-020b).
import { afterEach, describe, expect, it, vi } from "vitest";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { createEditor, type EditorHandle } from "../../../src/renderer/editor/create-editor";

const open: EditorHandle[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const editor of open.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

async function mount(rowsFirst = false): Promise<EditorHandle> {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = await createEditor(host, { scope: "details", value: "text", tableRowsFirst: () => rowsFirst });
  open.push(editor);
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 2)));
  return editor;
}

const table = () => document.querySelector<HTMLButtonElement>('.fmenu button[data-cmd="table"]') as HTMLButtonElement;
const grid = () => document.querySelector<HTMLElement>(".tsize") as HTMLElement;
const gridBox = () => grid().querySelector<HTMLElement>(".ts-grid") as HTMLElement;
const key = (target: HTMLElement, k: string, extra: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }));
const header = (cols: number) => `| ${Array.from({ length: cols }, () => " ").join(" | ")} |`;
const shape = (md: string) => {
  const lines = md.split("\n").filter((l) => l.startsWith("|"));
  return { rows: lines.length - 1, cols: (lines[0]?.match(/\|/g)?.length ?? 1) - 1 };
};

describe("FR-018 FR-019 FR-020 the Table option", () => {
  it("FR-018 FR-007 a click inserts 3 columns × (header + 2 rows) in one Undo step", async () => {
    const e = await mount();
    table().click();
    expect(shape(e.getMarkdown())).toEqual({ cols: 3, rows: 3 });
    undo(e.view.state, e.view.dispatch);
    expect(e.getMarkdown()).toBe("text");
  });

  it("FR-019 FR-020 a press held 500 ms opens the grid at 1 × 1; the release keeps it open and inserts nothing", async () => {
    const e = await mount();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    table().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    vi.advanceTimersByTime(499);
    expect(grid().hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(grid().hidden).toBe(false);
    table().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
    table().click();
    expect(grid().hidden).toBe(false);
    expect(e.getMarkdown()).toBe("text");
    expect(grid().querySelector(".tsize-label")?.textContent).toBe("1 × 1");
    expect(grid().querySelectorAll(".ts-cell")).toHaveLength(64);
  });

  it("FR-019 Shift+Enter opens with the focus in the grid; arrows grow it; Enter inserts that size", async () => {
    const e = await mount();
    key(table(), "Enter", { shiftKey: true });
    expect(document.activeElement).toBe(gridBox());
    for (let i = 0; i < 8; i++) key(gridBox(), "ArrowRight");
    key(gridBox(), "ArrowDown");
    expect(grid().querySelector(".tsize-label")?.textContent).toBe("9 × 2");
    expect(grid().querySelectorAll(".ts-row")).toHaveLength(8);
    expect(grid().querySelector(".ts-row")?.children).toHaveLength(10);
    expect(gridBox().getAttribute("aria-activedescendant")).toMatch(/-9-2$/);
    expect(document.getElementById(gridBox().getAttribute("aria-activedescendant") ?? "")?.getAttribute("aria-label")).toBe("9 columns by 2 rows");
    key(gridBox(), "Enter");
    expect(shape(e.getMarkdown())).toEqual({ cols: 9, rows: 2 });
    expect(grid().hidden).toBe(true);
  });

  it("FR-020 Esc and an outside click close with nothing inserted; Esc focuses the Table button", async () => {
    const e = await mount();
    key(table(), "Enter", { shiftKey: true });
    key(gridBox(), "Escape");
    expect(grid().hidden).toBe(true);
    expect(document.activeElement).toBe(table());
    key(table(), "Enter", { shiftKey: true });
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(grid().hidden).toBe(true);
    expect(e.getMarkdown()).toBe("text");
  });

  it("FR-020 a cell click inserts; the pointer leaving keeps the highlight", async () => {
    const e = await mount();
    key(table(), "Enter", { shiftKey: true });
    const cell = grid().querySelector<HTMLElement>('.ts-cell[data-col="4"][data-row="2"]') as HTMLElement;
    cell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    gridBox().dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
    expect(grid().querySelector(".tsize-label")?.textContent).toBe("4 × 2");
    (grid().querySelector<HTMLElement>('.ts-cell[data-col="4"][data-row="2"]') as HTMLElement).click();
    expect(shape(e.getMarkdown())).toEqual({ cols: 4, rows: 2 });
  });

  it("FR-020a the fields insert any size to 100; out of range shows the message; a typed size moves the highlight", async () => {
    const e = await mount();
    key(table(), "Enter", { shiftKey: true });
    const [cols, rows] = Array.from(grid().querySelectorAll<HTMLInputElement>("input[type='number']"));
    if (!cols || !rows) throw new Error("fields");
    cols.value = "4";
    rows.value = "2";
    cols.dispatchEvent(new Event("input", { bubbles: true }));
    expect(grid().querySelector(".tsize-label")?.textContent).toBe("4 × 2");
    cols.value = "101";
    cols.dispatchEvent(new Event("input", { bubbles: true }));
    key(cols, "Enter");
    expect(cols.getAttribute("aria-invalid")).toBe("true");
    expect(grid().querySelector<HTMLElement>(".tsize-error")?.hidden).toBe(false);
    expect(e.getMarkdown()).toBe("text");
    cols.value = "30";
    rows.value = "5";
    (grid().querySelector<HTMLButtonElement>(".ts-insert") as HTMLButtonElement).click();
    expect(shape(e.getMarkdown())).toEqual({ cols: 30, rows: 5 });
    expect(e.getMarkdown()).toContain(header(30).slice(0, 10));
  });

  it("FR-020b with rows first, the fields read Rows then Columns and the size text {h} × {w}", async () => {
    await mount(true);
    key(table(), "Enter", { shiftKey: true });
    key(gridBox(), "ArrowRight");
    const labels = Array.from(grid().querySelectorAll(".ts-field > span")).map((s) => s.textContent);
    expect(labels).toEqual(["Rows", "Columns"]);
    expect(grid().querySelector(".tsize-label")?.textContent).toBe("1 × 2");
    expect(document.getElementById(gridBox().getAttribute("aria-activedescendant") ?? "")?.getAttribute("aria-label")).toBe("1 rows by 2 columns");
  });
});
