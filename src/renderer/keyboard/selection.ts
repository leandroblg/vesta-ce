/**
 * Keyboard selection on the main view, the Archive and the Trash (007 FR-024 to FR-031a, research §12).
 * The selection is the card or entry that contains the focused element; moving it focuses the next card's
 * first control: the done checkbox on the main view, Restore in the Archive and Trash.
 */
import { afterRemoval, nextCard, type CardRef } from "../../domain/selection";
import { visibleUndoToken } from "../../domain/notifications";
import { atReminderLimit } from "../../domain/reminder-views";
import { isActive } from "../../domain/task";
import { flushAll } from "../store/flush";
import { NEW_REMINDER, NEW_TASK, actions, newSubKey, useVesta } from "../store/store";
import { inEditor } from "./editing";
import { isClose, registerHandler } from "./registry";

/** Menus, popovers and dialogs whose own Esc comes first (as in useClickRules' KEEPS_OPEN). */
const KEEPS_OPEN_SELECTOR = ".menu, [role='dialog'], .cpick, .tsize";

const LISTS = '[data-list="rem"], [data-list="tasks"], [data-list="entries"]';
const NOT_SELECTING = "button, input, select, textarea, a, label, [contenteditable], .editing, [data-ctl]";

function mainRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".main-inner");
}

/** The shown cards in on-screen order: reminders, then tasks and shown subtasks; or the view's entries. */
export function shownCards(): CardRef[] {
  const root = mainRoot();
  if (root === null) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(LISTS))
    .flatMap((list) => Array.from(list.querySelectorAll<HTMLElement>(":scope > li[data-id][data-kind]")))
    .flatMap((li) => {
      const id = li.dataset["id"];
      const kind = li.dataset["kind"];
      return id !== undefined && (kind === "task" || kind === "rem") ? [{ id, kind }] : [];
    });
}

function cardElement(id: string): HTMLElement | null {
  const root = mainRoot();
  if (root === null) return null;
  for (const list of Array.from(root.querySelectorAll<HTMLElement>(LISTS))) {
    const li = list.querySelector<HTMLElement>(`:scope > li[data-id="${CSS.escape(id)}"]`);
    if (li !== null) return li;
  }
  return null;
}

/** The selected card: the card that contains the focus, inside one of the view's lists. */
export function selectedCard(): CardRef | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return null;
  const li = el.closest<HTMLElement>("li[data-id][data-kind]");
  if (li?.parentElement?.matches(LISTS) !== true) return null;
  const id = li.dataset["id"];
  const kind = li.dataset["kind"];
  return id !== undefined && (kind === "task" || kind === "rem") ? { id, kind } : null;
}

/**
 * 013 FR-015, PRD Q182: what a menu command acts on. The keyboard's selection first; with none, and when the call
 * comes from the menu bar (no key event), the task open in the details panel, while no text field has the focus.
 */
export function commandCard(e?: KeyboardEvent): CardRef | null {
  const card = selectedCard();
  if (card !== null || e !== undefined) return card;
  const id = useVesta.getState().panelFor;
  if (id === null || useVesta.getState().tasks[id] === undefined) return null;
  return { id, kind: "task" };
}

/**
 * 018 FR-027, FR-028, FR-031 (PRD Q275): no card selected. The focus goes to the view's neutral target: the main area in
 * the main view, the view's heading in the Archive and the Trash. Nothing else changes.
 */
export function clearSelection(): void {
  const target = useVesta.getState().view === "tasks" ? mainRoot() : document.getElementById("view-h");
  target?.focus({ preventScroll: true });
}

/** Focuses a card's first control and scrolls it into view; retries while the card renders. */
export function focusCard(id: string, tries = 20): void {
  const li = cardElement(id);
  // 011 FR-022b: an Archive or Trash row is selected itself, so Enter opens and Shift+Enter restores.
  const anchor = li?.classList.contains("arow") === true ? li : li?.querySelector<HTMLElement>('[data-ctl="cb"], [data-ctl="restore"]');
  if (anchor) {
    anchor.focus();
    li?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (tries > 0)
    requestAnimationFrame(() => {
      focusCard(id, tries - 1);
    });
}

/** Where focus goes when nothing is left to select: a list's empty card, or the Archive or Trash heading. */
function focusEmpty(kind: CardRef["kind"]): void {
  if (useVesta.getState().view !== "tasks") {
    document.getElementById("view-h")?.focus();
    return;
  }
  requestAnimationFrame(() => {
    const list = document.querySelector<HTMLElement>(kind === "rem" ? '[data-list="rem"]' : '[data-list="tasks"]');
    const empty = list?.querySelector<HTMLElement>(".newbtn");
    (empty ?? list)?.focus();
  });
}

function focusAfter(orderBefore: readonly CardRef[], removed: ReadonlySet<string>, card: CardRef): void {
  const target = afterRemoval(orderBefore, removed, card.id);
  if (target === "emptyCard") focusEmpty(card.kind);
  else focusCard(target.id);
}

/** Up/Down act from a card, from the lists, or from nowhere; not from the header or the panel (FR-021). */
function selectionContext(): boolean {
  const el = document.activeElement;
  if (el === null || el === document.body) return true;
  const root = mainRoot();
  return root !== null && root.contains(el);
}

/** The ids that leave with a task: its subtasks on the main view, the rows that went with it elsewhere. */
function leavingWith(card: CardRef): Set<string> {
  const ids = new Set([card.id]);
  if (card.kind !== "task") return ids;
  const s = useVesta.getState();
  for (const t of Object.values(s.tasks)) {
    if (s.view === "tasks" ? t.parentId === card.id && isActive(t) : t.leftWithId === card.id) ids.add(t.id);
  }
  return ids;
}

/** The item a keyboard done, delete or restore acted on, to re-select it when undone (FR-029, FR-031a). */
let lastRemoved: { id: string; kind: CardRef["kind"]; view: string; token: string | null } | null = null;
/** The card a keyboard F2 opened, to re-select it when its edit closes (FR-028). */
let editedByKey: string | null = null;

/** Called once the action's reply is merged, so the visible undo notification is the action's own. */
function remember(card: CardRef): void {
  const s = useVesta.getState();
  lastRemoved = { ...card, view: s.view, token: visibleUndoToken(s.notifications) };
}

async function removeSelected(card: CardRef, run: () => Promise<unknown>): Promise<void> {
  const order = shownCards();
  const leaving = leavingWith(card);
  await run();
  // A failed save leaves the item where it was, and the selection on it.
  if (isShown(card)) return;
  remember(card);
  focusAfter(order, leaving, card);
}

/**
 * 013 PRD Q187: Delete Permanently on the selected Trash entry; once the item is gone (not on Cancel), the
 * selection moves on as it does after Move to Trash.
 */
export async function removeFromTrash(card: CardRef, run: () => Promise<unknown>): Promise<void> {
  const order = shownCards();
  const leaving = leavingWith(card);
  await run();
  const s = useVesta.getState();
  if ((card.kind === "task" ? s.tasks[card.id] : s.reminders[card.id]) !== undefined) return;
  focusAfter(order, leaving, card);
}

function isShown(card: CardRef): boolean {
  const s = useVesta.getState();
  const row = card.kind === "task" ? s.tasks[card.id] : s.reminders[card.id];
  return row !== undefined && row.doneAt === null && row.deletedAt === null;
}

export function installSelectionHandlers(): () => void {
  const move = (dir: "next" | "prev") => () => {
    if (!selectionContext()) return false;
    const next = nextCard(shownCards(), selectedCard()?.id ?? null, dir);
    if (next === null) return false;
    focusCard(next.id);
    // FR-026: the panel follows the selection; a reminder closes it.
    const s = useVesta.getState();
    if (s.panelFor !== null) {
      if (next.kind === "task") actions.openPanel(next.id);
      else actions.closePanel();
    }
    return true;
  };

  const off = [
    registerHandler("down", move("next")),
    registerHandler("up", move("prev")),
    registerHandler("open", (e) => {
      const card = selectedCard();
      if (card === null) return false;
      // Enter on a button inside the card keeps the button's own action; the menu bar (no event) always opens.
      const target = e?.target as HTMLElement | undefined;
      if (target !== undefined && target.dataset["ctl"] !== "cb" && !target.matches("li[data-id]")) return false;
      // 011 FR-022b: in the Archive and the Trash, Enter on a reminder does nothing (it has no details).
      if (card.kind !== "task") return useVesta.getState().view !== "tasks";
      actions.openPanel(card.id);
      return true;
    }),
    registerHandler("edit", () => {
      const card = selectedCard();
      if (card === null) return false;
      editedByKey = card.id;
      actions.startEditing(card.id);
      return true;
    }),
    registerHandler("done", (e) => {
      const card = commandCard(e);
      if (card === null) return false;
      void removeSelected(card, () => (card.kind === "task" ? actions.markDone(card.id) : actions.markReminderDone(card.id)));
      return true;
    }),
    registerHandler("del", (e) => {
      const card = commandCard(e);
      if (card === null) return false;
      // 013 PRD Q187, 018 FR-009: Move to Trash acts in the main view and the Archive; in the Trash the keys are Delete
      // Permanently (a separate action of the trash view).
      if (useVesta.getState().view === "trash") return false;
      void removeSelected(card, () => (card.kind === "task" ? actions.delete(card.id) : actions.deleteReminder(card.id)));
      return true;
    }),
    registerHandler("restore", (e) => {
      const card = commandCard(e);
      if (card === null) return false;
      const order = shownCards();
      const leaving = leavingWith(card);
      void (card.kind === "task" ? actions.restore(card.id) : actions.restoreReminder(card.id)).then(() => {
        if (!isShown(card)) return;
        remember(card);
        focusAfter(order, leaving, card);
      });
      return true;
    }),
    registerHandler("collapse", () => {
      const card = selectedCard();
      const s = useVesta.getState();
      if (card?.kind !== "task" || s.search.active) return false;
      const task = s.tasks[card.id];
      if (task === undefined) return false;
      const parent = task.parentId === null ? task : s.tasks[task.parentId];
      if (parent === undefined) return false;
      const hasSubs = Object.values(s.tasks).some((x) => x.parentId === parent.id && isActive(x));
      if (!hasSubs) return false;
      if (!parent.collapsed) void actions.setCollapsed(parent.id, true);
      if (parent.id !== task.id) focusCard(parent.id);
      return true;
    }),
    registerHandler("expand", () => {
      const card = selectedCard();
      const s = useVesta.getState();
      if (card?.kind !== "task" || s.search.active) return false;
      const task = s.tasks[card.id];
      if (task?.parentId !== null || !task.collapsed) return false;
      const hasSubs = Object.values(s.tasks).some((x) => x.parentId === task.id && isActive(x));
      if (!hasSubs) return false;
      void actions.setCollapsed(task.id, false);
      return true;
    }),
    // FR-031: the add actions, from anywhere in the window; pending edits are saved first.
    registerHandler("newTask", () => {
      void flushAll().finally(() => {
        if (useVesta.getState().view !== "tasks") actions.setView("tasks");
        actions.startEditing(NEW_TASK);
      });
      return true;
    }),
    registerHandler("newRem", () => {
      const s = useVesta.getState();
      if (atReminderLimit(Object.values(s.reminders))) return false;
      void flushAll().finally(async () => {
        if (useVesta.getState().view !== "tasks") actions.setView("tasks");
        if (useVesta.getState().remindersCollapsed) await actions.setRemindersCollapsed(false);
        actions.startEditing(NEW_REMINDER);
      });
      return true;
    }),
    registerHandler("newSub", (e) => {
      const card = commandCard(e);
      const s = useVesta.getState();
      if (card?.kind !== "task" || s.view !== "tasks") return false;
      const task = s.tasks[card.id];
      if (task === undefined) return false;
      const parentId = task.parentId ?? task.id;
      void flushAll().finally(async () => {
        if (useVesta.getState().tasks[parentId]?.collapsed === true) await actions.setCollapsed(parentId, false);
        actions.startEditing(newSubKey(parentId));
      });
      return true;
    }),
  ];

  // FR-024, analysis G1: a pointer-down on a card outside its controls selects it; the click goes on.
  const onPointerDown = (e: PointerEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    // 018 FR-029 (PRD Q275): a press outside every card ends an F2 edit by saving it, and the selection is not restored.
    if (target !== null && target.closest("li[data-kind]") === null && target.closest(KEEPS_OPEN_SELECTOR) === null) editedByKey = null;
    if (target === null || target.closest(NOT_SELECTING) !== null) return;
    const li = target.closest<HTMLElement>("li[data-id][data-kind]");
    if (li?.parentElement?.matches(LISTS) !== true) return;
    const id = li.dataset["id"];
    if (id === undefined) return;
    // After the browser's own pointer-down focus handling. A click that opened something that takes the
    // focus (an inline editor, the details panel's editor) keeps it there: the card is selected only while
    // the focus is still nowhere or inside the card.
    setTimeout(() => {
      const active = document.activeElement;
      if (useVesta.getState().editingKey !== null) return;
      if (active !== null && active !== document.body && active !== li.parentElement && !li.contains(active)) return;
      focusCard(id, 0);
    }, 0);
  };

  // CHK021: a selected card that disappears (search filter, collapse, purge) leaves the focus on its list.
  let last: { li: HTMLElement; list: HTMLElement } | null = null;
  const onFocusTrack = (e: FocusEvent) => {
    const el = e.target instanceof HTMLElement ? e.target : null;
    const li = el?.closest<HTMLElement>("li[data-id][data-kind]") ?? null;
    const list = li?.parentElement ?? null;
    last = li !== null && list?.matches(LISTS) === true ? { li, list } : null;
  };
  const observer = new MutationObserver(() => {
    if (last === null || last.li.isConnected) return;
    const lost = document.activeElement === null || document.activeElement === document.body;
    const { list } = last;
    last = null;
    if (lost && list.isConnected) list.focus();
  });
  const root = document.querySelector(".main");
  if (root !== null) observer.observe(root, { childList: true, subtree: true });

  // FR-028: after an F2 edit closes, the same card is selected again.
  const unsubscribe = useVesta.subscribe((state, prev) => {
    if (editedByKey !== null && prev.editingKey === editedByKey && state.editingKey !== editedByKey) {
      const id = editedByKey;
      editedByKey = null;
      focusCard(id);
    }
    // FR-029, FR-031a: an undone keyboard done, delete or restore re-selects the item where it came back.
    // The undo's reply arrives after its notification closes, so watch until the item is back, or until
    // another undoable action shows its own notification.
    if (lastRemoved !== null) {
      const token = visibleUndoToken(state.notifications);
      if (token !== null && token !== lastRemoved.token) {
        lastRemoved = null;
      } else {
        const back = lastRemoved;
        const row = back.kind === "task" ? state.tasks[back.id] : state.reminders[back.id];
        const active = row !== undefined && row.doneAt === null && row.deletedAt === null;
        const returned = back.view === "tasks" ? active : row !== undefined && !active;
        if (returned && token === null) {
          lastRemoved = null;
          if (state.view === back.view) focusCard(back.id);
        }
      }
    }
  });

  // 018 FR-028 (PRD Q275): Esc (the Close action) with the details panel closed clears the selection; with the panel
  // open the panel's own rule closes it first. An edit, a menu, a popover or a dialog keeps its own Esc.
  const onCloseKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || !isClose(e)) return;
    const s = useVesta.getState();
    if (s.panelFor !== null || s.menuFor !== null || s.overrideFor !== null || s.editingKey !== null) return;
    if (s.settingsOpen || s.aboutOpen || inEditor(e.target)) return;
    if (document.querySelector(KEEPS_OPEN_SELECTOR) !== null) return;
    if (selectedCard() === null) return;
    e.preventDefault();
    clearSelection();
  };

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("focusin", onFocusTrack);
  document.addEventListener("keydown", onCloseKey);
  return () => {
    for (const f of off) f();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("focusin", onFocusTrack);
    document.removeEventListener("keydown", onCloseKey);
    observer.disconnect();
    unsubscribe();
  };
}
