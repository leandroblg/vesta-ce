// 011 US3: table rows and columns through the menu options and the handles (FR-021, US3-8 to US3-10).
import { afterEach, describe, expect, it } from "vitest";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { cellAround } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createEditor, type EditorHandle } from "../../../src/renderer/editor/create-editor";
import { applicableActions, rowHandlePosition, runTableAction } from "../../../src/renderer/editor/table-handles";
import { parseMarkdown } from "../../../src/domain/markdown/parse";

const TABLE = "| h1 | h2 | h3 |\n| -- | -- | -- |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |";

const open: EditorHandle[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

async function mount(value = TABLE): Promise<EditorHandle> {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = await createEditor(host, { scope: "details", value });
  open.push(editor);
  return editor;
}

function caret(view: EditorView, text: string): void {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    const i = node.isText ? (node.text?.indexOf(text) ?? -1) : -1;
    if (i >= 0 && at < 0) at = pos + i;
  });
  if (at < 0) throw new Error(text);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

/** The table as rows of cell texts, read back through markdown. */
function rows(md: string): string[][] {
  return md
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*:?-/.test(l))
    .map((l) =>
      l
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim()),
    );
}

/** The text of the cell holding the cursor. */
function cursorCell(view: EditorView): string {
  const $cell = cellAround(view.state.selection.$head);
  return $cell === null ? "" : (view.state.doc.nodeAt($cell.pos)?.textContent ?? "");
}

const options = () => Array.from(document.querySelectorAll<HTMLButtonElement>(".fmenu button[data-cmd]"));

describe("FR-021 table rows and columns", () => {
  it("FR-021 the six menu options show in order while the cursor is in a body cell", async () => {
    const e = await mount();
    caret(e.view, "a2");
    const shown = options()
      .filter((b) => !b.hidden && ["row-above", "row-below", "col-left", "col-right", "row-delete", "col-delete"].includes(b.dataset["cmd"] ?? ""))
      .map((b) => b.getAttribute("aria-label"));
    expect(shown).toEqual(["Add row above", "Add row below", "Add column left", "Add column right", "Remove row", "Remove column"]);
    caret(e.view, "h1");
    // 012 FR-023: Delete table applies everywhere in a table.
    expect(applicableActions(e.view.state)).toEqual(["row-below", "col-left", "col-right", "col-delete", "table-delete"]);
  });

  it("FR-021 insert row above and below: the cursor goes to the new row's first cell; one Undo each", async () => {
    const e = await mount();
    caret(e.view, "a2");
    runTableAction(e.view, "row-above");
    expect(rows(e.getMarkdown()).map((r) => r[0])).toEqual(["h1", "", "a1", "b1"]);
    expect(e.view.state.selection.$head.parent.textContent).toBe("");
    expect(cellAround(e.view.state.selection.$head)?.index()).toBe(0);
    undo(e.view.state, e.view.dispatch);
    expect(e.getMarkdown()).toBe(TABLE);
    caret(e.view, "b2");
    runTableAction(e.view, "row-below");
    expect(rows(e.getMarkdown()).map((r) => r[0])).toEqual(["h1", "a1", "b1", ""]);
  });

  it("FR-021 insert column left and right: the cursor goes to the new column's first cell", async () => {
    const e = await mount();
    caret(e.view, "a2");
    runTableAction(e.view, "col-left");
    expect(rows(e.getMarkdown())[0]).toEqual(["h1", "", "h2", "h3"]);
    caret(e.view, "a3");
    runTableAction(e.view, "col-right");
    expect(rows(e.getMarkdown())[0]).toEqual(["h1", "", "h2", "h3", ""]);
    expect(cellAround(e.view.state.selection.$head)?.index()).toBe(4);
    expect(e.view.state.selection.$head.node(-2).type.name).toBe("table_header_row");
  });

  it("FR-021 delete row: the same column of the row below, above when it was the last", async () => {
    const e = await mount();
    caret(e.view, "a2");
    runTableAction(e.view, "row-delete");
    expect(rows(e.getMarkdown()).map((r) => r[1])).toEqual(["h2", "b2"]);
    expect(cursorCell(e.view)).toBe("b2");
    expect(applicableActions(e.view.state)).not.toContain("row-delete");
  });

  it("FR-021 delete column: the same row of the column to the left, right when it was the first", async () => {
    const e = await mount();
    caret(e.view, "a2");
    runTableAction(e.view, "col-delete");
    expect(rows(e.getMarkdown())[1]).toEqual(["a1", "a3"]);
    expect(cursorCell(e.view)).toBe("a1");
    runTableAction(e.view, "col-delete");
    expect(rows(e.getMarkdown())[1]).toEqual(["a3"]);
    expect(cursorCell(e.view)).toBe("a3");
    expect(applicableActions(e.view.state)).not.toContain("col-delete");
  });

  it("US3-9 US3-10 the last body row and the header row offer no removal; a changed table round-trips", async () => {
    const e = await mount("| h1 | h2 |\n| -- | -- |\n| a1 | a2 |");
    caret(e.view, "a1");
    expect(applicableActions(e.view.state)).not.toContain("row-delete");
    expect(runTableAction(e.view, "row-delete")).toBe(false);
    caret(e.view, "h1");
    expect(applicableActions(e.view.state)).not.toContain("row-delete");
    runTableAction(e.view, "col-right");
    const md = e.getMarkdown();
    expect(parseMarkdown(md).children[0]?.type).toBe("table");
    const again = await mount(md);
    expect(again.getMarkdown()).toBe(md);
  });

  it("FR-021 the handles overlay shows for the cursor's cell and is hidden from assistive technology", async () => {
    const e = await mount();
    e.view.focus();
    caret(e.view, "a2");
    const overlay = document.querySelector<HTMLElement>(".tbl-handles");
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.querySelector(".tbl-h-row")).not.toBeNull();
    expect(overlay?.querySelector(".tbl-h-col")).not.toBeNull();
    expect(overlay?.querySelector<HTMLButtonElement>(".tbl-h-row")?.tabIndex).toBe(-1);
  });
});

// 012 US6: Delete table and the row handle at the row's right edge (FR-023 to FR-025, research §9).
describe("012 FR-023 Delete table", () => {
  it("FR-023 table-delete is applicable in every cell, header included", async () => {
    const e = await mount();
    for (const cell of ["h1", "a2", "b3"]) {
      caret(e.view, cell);
      expect(applicableActions(e.view.state), cell).toContain("table-delete");
    }
  });

  it("FR-023 Delete table removes the whole table and puts the cursor in the next block; one Undo restores it", async () => {
    const e = await mount(`before\n\n${TABLE}\n\nafter`);
    caret(e.view, "a2");
    expect(runTableAction(e.view, "table-delete")).toBe(true);
    expect(e.getMarkdown()).toBe("before\n\nafter");
    expect(e.view.state.selection.$from.parent.textContent).toBe("after");
    undo(e.view.state, e.view.dispatch);
    expect(e.getMarkdown()).toBe(`before\n\n${TABLE}\n\nafter`);
  });

  it("FR-023 a table that is last gets an empty paragraph after it for the cursor", async () => {
    const e = await mount(`before\n\n${TABLE}`);
    caret(e.view, "b1");
    runTableAction(e.view, "table-delete");
    expect(e.getMarkdown()).toBe("before");
    const $from = e.view.state.selection.$from;
    expect($from.parent.type.name).toBe("paragraph");
    expect($from.parent.textContent).toBe("");
  });

  it("Edge Cases the only block: the details hold one empty paragraph", async () => {
    const e = await mount();
    caret(e.view, "h2");
    runTableAction(e.view, "table-delete");
    expect(e.getMarkdown()).toBe("");
    expect(e.view.state.doc.childCount).toBe(1);
    expect(e.view.state.doc.firstChild?.type.name).toBe("paragraph");
  });

  it("FR-023 both handle menus offer Delete table after their own actions", async () => {
    const e = await mount();
    e.view.focus();
    caret(e.view, "a2");
    const overlay = document.querySelector<HTMLElement>(".tbl-handles") as HTMLElement;
    (overlay.querySelector(".tbl-h-row") as HTMLButtonElement).click();
    const items = () => Array.from(overlay.querySelectorAll<HTMLElement>(".tbl-menu [data-action]")).map((i) => i.dataset["action"]);
    expect(items()).toEqual(["row-above", "row-below", "row-delete", "table-delete"]);
    (overlay.querySelector(".tbl-h-col") as HTMLButtonElement).click();
    expect(items()).toEqual(["col-left", "col-right", "col-delete", "table-delete"]);
  });
});

describe("012 FR-024 the row handle's place", () => {
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height });

  it("FR-024 on the right edge of the row, at its middle", () => {
    expect(rowHandlePosition(rect(100, 50, 300, 90), rect(300, 80, 100, 30), Number.POSITIVE_INFINITY)).toEqual({ left: 402, top: 87 });
  });

  it("FR-024 a table wider than its scroll area: inside the right end of the row's visible part", () => {
    expect(rowHandlePosition(rect(100, 50, 900, 90), rect(700, 80, 100, 30), 500)).toEqual({ left: 482, top: 87 });
  });

  it("FR-024 a table ending just inside the visible edge: the handle moves in so it stays visible", () => {
    expect(rowHandlePosition(rect(100, 50, 390, 90), rect(400, 80, 90, 30), 500)).toEqual({ left: 482, top: 87 });
  });

  it("FR-023 deleting the table under the pointer leaves the overlay working (no stale cell)", async () => {
    const e = await mount(`before\n\n${TABLE}\n\nafter`);
    e.view.focus();
    caret(e.view, "a2");
    expect(() => runTableAction(e.view, "table-delete")).not.toThrow();
    expect(document.querySelector<HTMLElement>(".tbl-handles")?.hidden).toBe(true);
  });
});

describe("012 contracts/ui.md the row handle's test hook", () => {
  it("T081 the row handle carries data-row with the row index of the cursor's cell", async () => {
    const e = await mount();
    e.view.focus();
    const handle = () => document.querySelector<HTMLElement>(".tbl-handles .tbl-h-row");
    caret(e.view, "a2");
    expect(handle()?.dataset["row"]).toBe("1");
    caret(e.view, "b3");
    expect(handle()?.dataset["row"]).toBe("2");
    caret(e.view, "h1");
    expect(handle()?.dataset["row"]).toBe("0");
  });
});
