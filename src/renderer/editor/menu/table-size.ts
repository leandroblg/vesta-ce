// The table size grid (011 US3, FR-019 to FR-020b, research §14, contracts/ui.md): a growing 8 × 8 → 20 × 20
// grid with the size written under it, and Columns and Rows fields for any size up to 100 × 100. Appended to
// document.body; role="dialog" keeps the details panel open, and its keys are its own (keyboard/editing.ts).
import { GRID_MAX } from "../../../domain/limits";
import { gridSize, parseSize } from "../../../domain/editing/table-size";
import { t } from "../../i18n/t";

export interface TableSizeGrid {
  readonly element: HTMLElement;
  open(anchor: HTMLElement, focus: boolean): void;
  close(focusAnchor: boolean): void;
  isOpen(): boolean;
  relabel(): void;
  destroy(): void;
}

let ids = 0;

export function createTableSizeGrid(options: { rowsFirst: () => boolean; onInsert: (cols: number, rows: number) => void }): TableSizeGrid {
  const uid = `tsize-${String(++ids)}`;
  const el = document.createElement("div");
  el.className = "tsize";
  el.setAttribute("role", "dialog");
  el.hidden = true;

  const grid = document.createElement("div");
  grid.className = "ts-grid";
  grid.setAttribute("role", "grid");
  grid.tabIndex = 0;
  const label = document.createElement("p");
  label.className = "tsize-label";
  label.setAttribute("aria-hidden", "true");

  const fields = document.createElement("div");
  fields.className = "ts-fields";
  const field = (name: "cols" | "rows") => {
    const wrap = document.createElement("label");
    wrap.className = "ts-field";
    const text = document.createElement("span");
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = "100";
    input.step = "1";
    input.id = `${uid}-${name}`;
    input.setAttribute("aria-describedby", `${uid}-error`);
    wrap.append(text, input);
    return { wrap, text, input };
  };
  const cols = field("cols");
  const rows = field("rows");
  const insert = document.createElement("button");
  insert.type = "button";
  insert.className = "ts-insert";
  const error = document.createElement("p");
  error.className = "tsize-error";
  error.id = `${uid}-error`;
  error.setAttribute("role", "alert");
  error.hidden = true;
  fields.append(cols.wrap, rows.wrap, insert);
  el.append(grid, label, fields, error);

  let anchor: HTMLElement | null = null;
  let hc = 1;
  let hr = 1;

  const spoken = (c: number, r: number) => t(options.rowsFirst() ? "tsSpokenHW" : "tsSpokenWH", { w: c, h: r });

  let drawn: { cols: number; rows: number } | null = null;

  function draw(syncFields: boolean): void {
    const size = gridSize(hc, hr);
    // Cells stay in place while the grid keeps its size, so the pointer's target never detaches.
    if (drawn !== null && drawn.cols === size.cols && drawn.rows === size.rows) {
      for (const cell of Array.from(grid.querySelectorAll<HTMLElement>(".ts-cell"))) {
        const on = Number(cell.dataset.col) <= hc && Number(cell.dataset.row) <= hr;
        cell.setAttribute("aria-selected", String(on));
        cell.classList.toggle("on", on);
        cell.setAttribute("aria-label", spoken(Number(cell.dataset.col), Number(cell.dataset.row)));
      }
      finish(syncFields);
      return;
    }
    drawn = size;
    grid.replaceChildren();
    for (let r = 1; r <= size.rows; r++) {
      const row = document.createElement("div");
      row.className = "ts-row";
      row.setAttribute("role", "row");
      for (let c = 1; c <= size.cols; c++) {
        const cell = document.createElement("div");
        cell.className = "ts-cell";
        cell.setAttribute("role", "gridcell");
        cell.id = `${uid}-${String(c)}-${String(r)}`;
        cell.dataset.col = String(c);
        cell.dataset.row = String(r);
        cell.setAttribute("aria-label", spoken(c, r));
        const on = c <= hc && r <= hr;
        cell.setAttribute("aria-selected", String(on));
        cell.classList.toggle("on", on);
        row.append(cell);
      }
      grid.append(row);
    }
    finish(syncFields);
  }

  function finish(syncFields: boolean): void {
    grid.setAttribute("aria-activedescendant", `${uid}-${String(hc)}-${String(hr)}`);
    label.textContent = t(options.rowsFirst() ? "tsSizeHW" : "tsSizeWH", { w: hc, h: hr });
    if (syncFields) {
      cols.input.value = String(hc);
      rows.input.value = String(hr);
    }
    place();
  }

  function order(): void {
    cols.text.textContent = t("tsCols");
    rows.text.textContent = t("tsRows");
    // FR-020b: rows first when the setting is on.
    if (options.rowsFirst()) fields.replaceChildren(rows.wrap, cols.wrap, insert);
    else fields.replaceChildren(cols.wrap, rows.wrap, insert);
  }

  function labels(): void {
    el.setAttribute("aria-label", t("tsDialog"));
    grid.setAttribute("aria-label", t("tsDialog"));
    insert.textContent = t("tsInsert");
    error.textContent = t("tsRange");
    order();
  }

  function highlight(c: number, r: number, syncFields = true): void {
    const nc = Math.max(1, Math.min(GRID_MAX, c));
    const nr = Math.max(1, Math.min(GRID_MAX, r));
    if (drawn !== null && nc === hc && nr === hr && !el.hidden) return;
    hc = nc;
    hr = nr;
    draw(syncFields);
  }

  function showError(bad: HTMLInputElement[]): void {
    for (const i of [cols.input, rows.input]) i.setAttribute("aria-invalid", String(bad.includes(i)));
    error.hidden = bad.length === 0;
  }

  function insertFromFields(): void {
    const c = parseSize(cols.input.value);
    const r = parseSize(rows.input.value);
    const bad = [c === null ? cols.input : null, r === null ? rows.input : null].filter((x): x is HTMLInputElement => x !== null);
    showError(bad);
    if (c === null || r === null) return;
    done(c, r);
  }

  function done(c: number, r: number): void {
    close(false);
    options.onInsert(c, r);
  }

  grid.addEventListener("pointerover", (e) => {
    const cell = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(".ts-cell") : null;
    if (cell) highlight(Number(cell.dataset.col), Number(cell.dataset.row));
  });
  grid.addEventListener("click", (e) => {
    const cell = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(".ts-cell") : null;
    if (cell) done(Number(cell.dataset.col), Number(cell.dataset.row));
  });
  el.addEventListener("mousedown", (e) => {
    // The editor keeps its selection, so the table lands where the caret was.
    if (e.target instanceof Element && !e.target.closest("input")) e.preventDefault();
  });
  el.addEventListener("keydown", (e) => {
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "Escape") {
      handled();
      close(true);
      return;
    }
    if (e.target === grid) {
      const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const d = step[e.key];
      if (d !== undefined) {
        handled();
        highlight(hc + d[0], hr + d[1]);
        return;
      }
      if (e.key === "Enter") {
        handled();
        done(hc, hr);
      }
      return;
    }
    if (e.key === "Enter" && (e.target === cols.input || e.target === rows.input)) {
      handled();
      insertFromFields();
    }
  });
  const onType = () => {
    const c = parseSize(cols.input.value);
    const r = parseSize(rows.input.value);
    // FR-020a: a typed size up to 20 × 20 moves the grid's highlight, the grid growing to show it.
    if (c !== null && r !== null && c <= GRID_MAX && r <= GRID_MAX) highlight(c, r, false);
    if (!error.hidden) showError([]);
  };
  cols.input.addEventListener("input", onType);
  rows.input.addEventListener("input", onType);
  insert.addEventListener("click", insertFromFields);

  // A click outside the grid and its button closes it (FR-020).
  const onOutside = (e: PointerEvent) => {
    const target = e.target instanceof Node ? e.target : null;
    if (el.hidden || target === null || el.contains(target) || anchor?.contains(target) === true) return;
    close(false);
  };
  document.addEventListener("pointerdown", onOutside, true);

  function place(): void {
    if (anchor === null || el.hidden) return;
    const a = anchor.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const gap = 6;
    let top = a.bottom + gap;
    if (top + box.height > window.innerHeight - gap) top = Math.max(gap, window.innerHeight - gap - box.height);
    const left = Math.max(gap, Math.min(window.innerWidth - box.width - gap, a.left));
    el.style.top = `${String(Math.round(top))}px`;
    el.style.left = `${String(Math.round(left))}px`;
  }

  function close(focusAnchor: boolean): void {
    if (el.hidden) return;
    el.hidden = true;
    anchor?.setAttribute("aria-expanded", "false");
    if (focusAnchor) anchor?.focus();
  }

  const onResize = () => {
    place();
  };
  window.addEventListener("resize", onResize);
  document.body.append(el);

  return {
    element: el,
    open(a, focus) {
      anchor = a;
      a.setAttribute("aria-expanded", "true");
      labels();
      showError([]);
      el.hidden = false;
      drawn = null;
      hc = 1;
      hr = 1;
      draw(true);
      if (focus) grid.focus();
    },
    close,
    isOpen: () => !el.hidden,
    relabel() {
      labels();
      if (!el.hidden) draw(false);
    },
    destroy() {
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("resize", onResize);
      el.remove();
    },
  };
}
