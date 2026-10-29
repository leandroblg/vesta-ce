// Rows and columns of a table (011 FR-021, research §15, contracts/ui.md): the six actions, each one transaction
// that also places the cursor, shared by the floating menu's options (the keyboard and screen-reader path) and
// the handles overlay (a mouse aid, aria-hidden). GFM keeps the header row first: it is never removed, and no
// row goes above it; the last body row is not removed either (implementation finding, research §22).
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { TableMap, addColumn, cellAround, removeColumn, removeRow, type TableRect } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { t, type MessageKey } from "../i18n/t";

export type TableAction = "row-above" | "row-below" | "col-left" | "col-right" | "row-delete" | "col-delete" | "table-delete";

/** 012 FR-023: Delete table is the seventh action. */
export const TABLE_ACTIONS: readonly TableAction[] = ["row-above", "row-below", "col-left", "col-right", "row-delete", "col-delete", "table-delete"];

export const TABLE_ACTION_LABEL: Readonly<Record<TableAction, MessageKey>> = {
  "row-above": "fmRowAbove",
  "row-below": "fmRowBelow",
  "col-left": "fmColLeft",
  "col-right": "fmColRight",
  "row-delete": "fmRowDelete",
  "col-delete": "fmColDelete",
  "table-delete": "fmTableDelete",
};

interface Located {
  table: ProseNode;
  tablePos: number;
  tableStart: number;
  map: TableMap;
  row: number;
  col: number;
}

/** The table and the cell at `cellPos` (a position before a cell), or the cursor's cell. */
function locate(state: EditorState, cellPos?: number): Located | null {
  const $cell = cellPos === undefined ? cellAround(state.selection.$head) : state.doc.resolve(cellPos);
  if ($cell === null) return null;
  for (let d = $cell.depth; d > 0; d--) {
    const node = $cell.node(d);
    if (node.type.spec["tableRole"] !== "table") continue;
    const tableStart = $cell.start(d);
    const map = TableMap.get(node);
    const rect = map.findCell($cell.pos - tableStart);
    return { table: node, tablePos: $cell.before(d), tableStart, map, row: rect.top, col: rect.left };
  }
  return null;
}

/** The actions that apply to that cell: no row above or removal for the header, no removal of the only column. */
export function applicableActions(state: EditorState, cellPos?: number): TableAction[] {
  const at = locate(state, cellPos);
  if (at === null) return [];
  return TABLE_ACTIONS.filter((a) => {
    if ((a === "row-above" || a === "row-delete") && at.row === 0) return false;
    // Milkdown's GFM table keeps at least one body row (schema `table_header_row table_row+`).
    if (a === "row-delete" && at.map.height <= 2) return false;
    if (a === "col-delete" && at.map.width <= 1) return false;
    return true;
  });
}

function rectOf(at: Located): TableRect {
  return { left: at.col, right: at.col + 1, top: at.row, bottom: at.row + 1, map: at.map, table: at.table, tableStart: at.tableStart };
}

/** A body row with empty cells, each aligned like its column's header (as Milkdown's own row command). */
function insertBodyRow(tr: Transaction, at: Located, index: number): void {
  const schema = tr.doc.type.schema;
  const rowType = schema.nodes["table_row"];
  const cellType = schema.nodes["table_cell"];
  if (!rowType || !cellType) return;
  let pos = at.tableStart;
  for (let i = 0; i < index; i++) pos += at.table.child(i).nodeSize;
  const cells: ProseNode[] = [];
  for (let c = 0; c < at.map.width; c++) {
    const header = at.table.nodeAt(at.map.map[c] as number);
    const cell = cellType.createAndFill({ alignment: (header?.attrs["alignment"] as string | null | undefined) ?? null });
    if (cell) cells.push(cell);
  }
  tr.insert(pos, rowType.create(null, cells));
}

/** Runs one action on the cell (or the cursor's cell) and puts the cursor where FR-021 says, in one transaction. */
export function runTableAction(view: EditorView, action: TableAction, cellPos?: number): boolean {
  const state = view.state;
  if (!applicableActions(state, cellPos).includes(action)) return false;
  const at = locate(state, cellPos);
  if (at === null) return false;
  const tr = state.tr;
  if (action === "table-delete") {
    // 012 FR-023: the whole table, in one Undo step; the cursor goes to the next block, or to a new empty
    // paragraph when the table was last (or the only block).
    const end = at.tablePos + at.table.nodeSize;
    const $end = state.doc.resolve(end);
    const paragraph = state.schema.nodes["paragraph"];
    if ($end.index() < $end.parent.childCount) {
      tr.delete(at.tablePos, end);
      tr.setSelection(Selection.near(tr.doc.resolve(at.tablePos), 1));
    } else if (paragraph) {
      tr.replaceWith(at.tablePos, end, paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, at.tablePos + 1));
    }
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  let target: { row: number; col: number };
  switch (action) {
    case "row-above":
      insertBodyRow(tr, at, at.row);
      target = { row: at.row, col: 0 };
      break;
    case "row-below":
      insertBodyRow(tr, at, at.row + 1);
      target = { row: at.row + 1, col: 0 };
      break;
    case "col-left":
      addColumn(tr, rectOf(at), at.col);
      target = { row: 0, col: at.col };
      break;
    case "col-right":
      addColumn(tr, rectOf(at), at.col + 1);
      target = { row: 0, col: at.col + 1 };
      break;
    case "row-delete":
      removeRow(tr, rectOf(at), at.row);
      target = { row: at.row < at.map.height - 1 ? at.row : at.row - 1, col: at.col };
      break;
    case "col-delete":
      removeColumn(tr, rectOf(at), at.col);
      target = { row: at.row, col: at.col > 0 ? at.col - 1 : 0 };
      break;
  }
  const table = tr.doc.nodeAt(at.tablePos);
  if (table !== null) {
    const map = TableMap.get(table);
    const row = Math.min(target.row, map.height - 1);
    const col = Math.min(target.col, map.width - 1);
    const cell = at.tableStart + (map.map[row * map.width + col] as number);
    tr.setSelection(TextSelection.near(tr.doc.resolve(cell + 1)));
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

// ---------------------------------------------------------------------------
// The handles overlay: a row handle on the row's right edge (012 FR-024) and a column handle on the table's top
// edge, for the cell under the pointer or, with the pointer outside the table, the cursor's cell.

interface Box {
  left: number;
  top: number;
  right: number;
  height: number;
}

const HANDLE = 16;

/**
 * 012 FR-024: the row handle sits just past the row's right edge, mirroring where it sat on the left edge, so it
 * covers no cell text; on a table wider than its scroll area, inside the right end of the row's visible part.
 */
export function rowHandlePosition(table: Box, cell: Box, visibleRight: number): { left: number; top: number } {
  const left = table.right + 2 + HANDLE <= visibleRight ? table.right + 2 : visibleRight - HANDLE - 2;
  return { left: Math.round(left), top: Math.round(cell.top + cell.height / 2 - 8) };
}

/** A table cell starts at `pos` in the current document. */
function isCellAt(state: EditorState, pos: number): boolean {
  if (pos < 0 || pos >= state.doc.content.size) return false;
  const role = state.doc.nodeAt(pos)?.type.spec["tableRole"] as string | undefined;
  return role === "cell" || role === "header_cell";
}

/** The right edge of the nearest ancestor that scrolls the table sideways, or no limit. */
function visibleRightOf(el: HTMLElement): number {
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowX;
    if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") return p.getBoundingClientRect().right;
  }
  return Number.POSITIVE_INFINITY;
}

class HandlesView {
  private readonly overlay = document.createElement("div");
  private readonly rowHandle = document.createElement("button");
  private readonly colHandle = document.createElement("button");
  private readonly menu = document.createElement("div");
  private pointerCell: number | null = null;
  private target: number | null = null;

  constructor(private readonly view: EditorView) {
    this.overlay.className = "tbl-handles";
    this.overlay.setAttribute("aria-hidden", "true");
    this.overlay.hidden = true;
    for (const [button, cls, glyph] of [
      [this.rowHandle, "tbl-h-row", "⋮"],
      [this.colHandle, "tbl-h-col", "⋯"],
    ] as const) {
      button.type = "button";
      button.className = cls;
      button.tabIndex = -1;
      button.textContent = glyph;
    }
    this.menu.className = "tbl-menu";
    this.menu.setAttribute("role", "menu");
    this.menu.hidden = true;
    this.overlay.append(this.rowHandle, this.colHandle, this.menu);
    document.body.append(this.overlay);

    this.overlay.addEventListener("mousedown", (e) => {
      // The editor keeps its focus and selection.
      e.preventDefault();
    });
    this.rowHandle.addEventListener("click", () => {
      this.openMenu(["row-above", "row-below", "row-delete", "table-delete"], this.rowHandle);
    });
    this.colHandle.addEventListener("click", () => {
      this.openMenu(["col-left", "col-right", "col-delete", "table-delete"], this.colHandle);
    });
    this.menu.addEventListener("click", (e) => {
      const item = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>("[data-action]") : null;
      if (item === null) return;
      const at = this.target;
      this.menu.hidden = true;
      runTableAction(this.view, item.dataset["action"] as TableAction, at ?? undefined);
      this.view.focus();
    });
    view.dom.addEventListener("mousemove", this.onMove);
    view.dom.addEventListener("mouseleave", this.onLeave);
  }

  private readonly onMove = (e: MouseEvent) => {
    const at = this.view.posAtCoords({ left: e.clientX, top: e.clientY });
    const $cell = at === null ? null : cellAround(this.view.state.doc.resolve(at.pos));
    const next = $cell?.pos ?? null;
    if (next !== this.pointerCell) {
      this.pointerCell = next;
      this.render();
    }
  };

  private readonly onLeave = (e: MouseEvent) => {
    if (e.relatedTarget instanceof Node && this.overlay.contains(e.relatedTarget)) return;
    this.pointerCell = null;
    this.render();
  };

  private openMenu(actions: TableAction[], anchor: HTMLElement): void {
    const allowed = new Set(applicableActions(this.view.state, this.target ?? undefined));
    this.menu.replaceChildren(
      ...actions
        .filter((a) => allowed.has(a))
        .map((a) => {
          const item = document.createElement("button");
          item.type = "button";
          item.setAttribute("role", "menuitem");
          item.tabIndex = -1;
          item.dataset["action"] = a;
          item.textContent = t(TABLE_ACTION_LABEL[a]);
          return item;
        }),
    );
    const r = anchor.getBoundingClientRect();
    this.menu.style.left = `${String(Math.round(r.left))}px`;
    this.menu.style.top = `${String(Math.round(r.bottom + 4))}px`;
    this.menu.hidden = this.menu.childElementCount === 0;
  }

  render(): void {
    const state = this.view.state;
    // A cell the pointer was over may be gone (a deleted row or table): forget a position that is no cell now.
    if (this.pointerCell !== null && !isCellAt(state, this.pointerCell)) this.pointerCell = null;
    if (this.target !== null && !isCellAt(state, this.target)) this.target = null;
    const cursor = cellAround(state.selection.$head)?.pos ?? null;
    const cell = this.pointerCell ?? (this.view.hasFocus() ? cursor : null);
    if (cell === null) {
      this.overlay.hidden = true;
      this.menu.hidden = true;
      this.target = null;
      return;
    }
    if (cell !== this.target) this.menu.hidden = true;
    this.target = cell;
    const cellDom = this.view.nodeDOM(cell);
    const $cell = state.doc.resolve(cell);
    let tablePos: number | null = null;
    for (let d = $cell.depth; d > 0; d--) if ($cell.node(d).type.spec["tableRole"] === "table") tablePos = $cell.before(d);
    const tableDom = tablePos === null ? null : this.view.nodeDOM(tablePos);
    if (!(cellDom instanceof HTMLElement) || !(tableDom instanceof HTMLElement)) {
      this.overlay.hidden = true;
      return;
    }
    const c = cellDom.getBoundingClientRect();
    const tb = tableDom.getBoundingClientRect();
    this.overlay.hidden = false;
    const row = rowHandlePosition(tb, c, visibleRightOf(tableDom));
    // contracts/ui.md: the row's index, the header row being 0, as a test hook.
    const at = locate(state, cell);
    if (at !== null) this.rowHandle.dataset["row"] = String(at.row);
    this.rowHandle.style.left = `${String(row.left)}px`;
    this.rowHandle.style.top = `${String(row.top)}px`;
    this.colHandle.style.left = `${String(Math.round(c.left + c.width / 2 - 8))}px`;
    this.colHandle.style.top = `${String(Math.round(tb.top - 18))}px`;
  }

  update(): void {
    this.render();
  }

  destroy(): void {
    this.view.dom.removeEventListener("mousemove", this.onMove);
    this.view.dom.removeEventListener("mouseleave", this.onLeave);
    this.overlay.remove();
  }
}

export function tableHandlesPlugin(): Plugin {
  return new Plugin({ key: new PluginKey("vestaTableHandles"), view: (view) => new HandlesView(view) });
}
