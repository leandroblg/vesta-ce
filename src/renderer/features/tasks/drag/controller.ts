/**
 * The drag controller (004 research §1, §5): native pointer events on a list's <ul>, a 4 px threshold,
 * one layout snapshot per drag, one resolution per animation frame, auto-scroll, and the cancel rules of
 * FR-003. It draws through the store (dropIndicator) and a ghost element it owns; no card re-renders
 * while the pointer moves.
 */
import { resolveDrop, resolveReminderDrop, type Indicator, type LayoutRow } from "../../../../domain/drop-rules";
import type { MoveDest } from "../../../../domain/move";
import { isActive } from "../../../../domain/task";
import { flushAll } from "../../../store/flush";
import { actions, useVesta, type DropBox, type FrozenNode } from "../../../store/store";
import { announceMove, beforeOf } from "./keyboard";
import { snapshot, type Snapshot } from "./layout";
import { plain } from "../../../markdown/plain";

const THRESHOLD = 4;
const EDGE = 48;
const MAX_SCROLL = 16;
/** A pointer this far outside the list (in px) is not over it. */
const SLACK = 12;

/** Controls that keep their own meaning: a press there never starts a drag (FR-001). */
const NO_DRAG = ".cb, .twisty, .actions, textarea, input, .inline-edit, .edit-hint";

type Result = { dest: MoveDest; indicator: Indicator } | { beforeId: string | null; indicator: Indicator };

function boxOf(indicator: Indicator, snap: Snapshot): DropBox {
  if (indicator.kind === "line") {
    const indent = indicator.indent === "sub" ? snap.subIndent : 0;
    return { kind: indicator.indent === "sub" ? "line-sub" : "line-top", top: indicator.y - 1.5, left: snap.left + 6 + indent, width: snap.width - 12 - indent, height: 3 };
  }
  if (indicator.kind === "card") {
    const row = snap.rows.find((r) => r.key === indicator.rowKey) as LayoutRow;
    return { kind: "card", top: row.top, left: snap.left, width: snap.width, height: row.height };
  }
  // The group: from its first card to the last row before the first top-level task outside it.
  const first = snap.rows.findIndex((r) => r.inGroup);
  let end = first;
  for (let j = first + 1; j < snap.rows.length; j++) {
    const r = snap.rows[j] as LayoutRow;
    if (r.kind !== "sub" && !r.inGroup) break;
    end = j;
  }
  const top = (snap.rows[first] as LayoutRow).top;
  const last = snap.rows[end] as LayoutRow;
  return { kind: "group", top, left: snap.left, width: snap.width, height: last.top + last.height - top };
}

function frozenOrder(rows: readonly LayoutRow[]): FrozenNode[] {
  const nodes: FrozenNode[] = [];
  for (const r of rows) {
    if (r.kind === "task" && r.id !== null) nodes.push({ id: r.id, subs: [] });
    else if (r.kind === "sub" && r.id !== null) nodes[nodes.length - 1]?.subs.push(r.id);
  }
  return nodes;
}

function sameBox(a: DropBox | null, b: DropBox | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/** Attaches drag handling to a task list or the reminders list; returns the detach function. */
export function attachDrag(list: HTMLUListElement, kind: "task" | "rem"): () => void {
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.pointerType !== "mouse" && e.pointerType !== "pen")) return;
    if (useVesta.getState().movingDisabled || useVesta.getState().drag !== null) return;
    const target = e.target as Element;
    const li = target.closest<HTMLElement>("li[data-id]");
    if (li === null || !list.contains(li) || li.parentElement !== list) return;
    if (li.dataset["kind"] !== kind || li.classList.contains("editing") || target.closest(NO_DRAG) !== null) return;
    pending(list, kind, li, e);
  };
  list.addEventListener("pointerdown", onPointerDown);
  return () => {
    list.removeEventListener("pointerdown", onPointerDown);
  };
}

/** Waits for the threshold, then runs the drag; pointerup before it leaves the press as a click. */
function pending(list: HTMLUListElement, kind: "task" | "rem", li: HTMLElement, down: PointerEvent): void {
  const id = li.dataset["id"] ?? "";
  const startX = down.clientX;
  const startY = down.clientY;
  const move = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
    stop();
    void run(list, kind, id, li, e);
  };
  const stop = () => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", stop, true);
    window.removeEventListener("pointercancel", stop, true);
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", stop, true);
  window.addEventListener("pointercancel", stop, true);
}

async function run(list: HTMLUListElement, kind: "task" | "rem", id: string, li: HTMLElement, first: PointerEvent): Promise<void> {
  const scroller = list.closest<HTMLElement>(".main");
  const origin = list.closest<HTMLElement>(".main-inner");
  if (scroller === null || origin === null) return;
  // No text selection and a grabbing cursor while dragging, without restyling the whole list (a class on
  // the root re-computes every row's style, too slow with 1,000 rows, SC-004): a transparent layer shows
  // the cursor and passes wheel scrolling on to the list.
  window.getSelection()?.removeAllRanges();
  const noSelect = (e: Event) => {
    e.preventDefault();
  };
  document.addEventListener("selectstart", noSelect);
  const layer = document.createElement("div");
  layer.className = "drag-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      scroller.scrollBy(0, e.deltaY);
    },
    { passive: false },
  );
  document.body.append(layer);
  let pointer = { x: first.clientX, y: first.clientY };
  let released: PointerEvent | null = null;
  let ended = false;
  let snap: Snapshot | null = null;
  let result: Result | null = null;
  let frame = 0;

  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.setAttribute("aria-hidden", "true");
  const state = useVesta.getState();
  ghost.textContent = plain(kind === "task" ? (state.tasks[id]?.titleMd ?? "") : (state.reminders[id]?.textMd ?? ""));
  document.body.append(ghost);

  const onMove = (e: PointerEvent) => {
    pointer = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    released = e;
    finish(true);
  };
  const onCancel = () => {
    finish(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  };
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", onCancel);
  // The dragged row leaving the active list, the reminders section collapsing, or moving becoming
  // disabled ends the drag (FR-003, FR-018, FR-029).
  const unsubscribe = useVesta.subscribe((s) => {
    // Moving becoming disabled (a search starts, 006) cancels the drag (FR-029).
    if (s.movingDisabled) {
      finish(false);
      return;
    }
    if (kind === "task") {
      const row = s.tasks[id];
      if (row === undefined || !isActive(row)) finish(false);
    } else {
      const row = s.reminders[id];
      if (row === undefined || row.doneAt !== null || row.deletedAt !== null || s.remindersCollapsed) finish(false);
    }
  });

  function resolve(): Result | null {
    if (snap === null) return null;
    const box = list.getBoundingClientRect();
    const { x, y } = pointer;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null;
    if (x < box.left - SLACK || x > box.right + SLACK || y < box.top - SLACK || y > box.bottom + SLACK) return null;
    const contentY = y - (origin as HTMLElement).getBoundingClientRect().top;
    if (kind === "rem") return resolveReminderDrop(snap.rows, contentY, id);
    const s = useVesta.getState();
    const row = s.tasks[id];
    if (row === undefined) return null;
    return resolveDrop(snap.rows, contentY, {
      id,
      parentId: row.parentId,
      isParent: snap.rows.some((r) => r.parentId === id),
      stale: row.staleSince !== null,
    });
  }

  function tick() {
    if (ended) return;
    ghost.style.transform = `translate(${String(pointer.x + 14)}px, ${String(pointer.y + 10)}px)`;
    const sRect = (scroller as HTMLElement).getBoundingClientRect();
    if (pointer.y < sRect.top + EDGE) (scroller as HTMLElement).scrollTop -= Math.ceil(MAX_SCROLL * Math.min(1, (sRect.top + EDGE - pointer.y) / EDGE));
    else if (pointer.y > sRect.bottom - EDGE) (scroller as HTMLElement).scrollTop += Math.ceil(MAX_SCROLL * Math.min(1, (pointer.y - (sRect.bottom - EDGE)) / EDGE));
    result = resolve();
    const box = result === null || snap === null ? null : boxOf(result.indicator, snap);
    if (!sameBox(box, useVesta.getState().dropIndicator)) actions.setDropIndicator(box);
    frame = requestAnimationFrame(tick);
  }

  function finish(drop: boolean) {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onCancel);
    unsubscribe();
    ghost.remove();
    layer.remove();
    document.removeEventListener("selectstart", noSelect);
    // The click that follows a drag is not a click on a card (US1-7).
    const swallow = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => {
      window.removeEventListener("click", swallow, true);
    }, 0);
    if (drop && released !== null) {
      pointer = { x: released.clientX, y: released.clientY };
      result = resolve();
    }
    const chosen = drop ? result : null;
    actions.endDrag();
    if (chosen === null) return;
    const before = kind === "task" ? beforeOf(id) : null;
    const call = "dest" in chosen ? actions.moveTask(id, chosen.dest) : actions.moveReminder(id, chosen.beforeId);
    // FR-027: a drop is announced as a keyboard move is.
    void call.then((m) => {
      if (m !== null && (m.upserts.length > 0 || (m.reminders?.upserts.length ?? 0) > 0)) announceMove(id, kind, before);
    });
  }

  // Close menus and panels, save an open inline edit and close it, then measure (FR-005).
  actions.openMenu(null);
  actions.openOverride(null);
  // `ended` is set by the listeners while this awaits; read it through a call so it is not narrowed.
  const isEnded = () => ended;
  await flushAll();
  if (isEnded()) return;
  actions.stopEditing();
  await new Promise<void>((r) => {
    requestAnimationFrame(() => {
      r();
    });
  });
  if (isEnded()) return;
  snap = snapshot(list, origin);
  actions.startDrag(id, kind, kind === "task" ? frozenOrder(snap.rows) : null);
  tick();
}
