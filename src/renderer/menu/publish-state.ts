/**
 * 013 research §3: the renderer's command state for the menu bar, gathered from the store, the focus and the
 * active floating menu, coalesced to one per animation frame and sent only when it changed.
 */
import { commandState, sameState, type CommandState, type CommandStateInput, type Target } from "../../domain/menu/state";
import { visibleRedoToken, visibleUndoToken } from "../../domain/notifications";
import { atReminderLimit } from "../../domain/reminder-views";
import { activeEditor } from "../editor/active";
import { inEditor, inTextField } from "../keyboard/editing";
import { selectedCard } from "../keyboard/selection";
import { useVesta, type VestaState } from "../store/store";

function targetOf(s: VestaState, card: { id: string; kind: "task" | "rem" } | null): Target | null {
  if (card === null) return null;
  if (card.kind === "rem") return { kind: "reminder", topLevel: true, stale: false };
  const task = s.tasks[card.id];
  if (task === undefined) return null;
  return { kind: task.parentId === null ? "task" : "subtask", topLevel: task.parentId === null, stale: task.staleSince !== null };
}

/** The plain input of `commandState`, read now. */
export function gatherInput(): CommandStateInput {
  const s = useVesta.getState();
  const editor = activeEditor();
  const focus = document.activeElement;
  return {
    view: s.view,
    focused: targetOf(s, selectedCard()),
    panelItem: s.panelFor === null ? null : targetOf(s, { id: s.panelFor, kind: "task" }),
    editorScope: editor?.scope ?? null,
    textFocus: editor === null && (inTextField(focus) || inEditor(focus)),
    format: editor?.formatSnapshot?.() ?? null,
    remindersCollapsed: s.remindersCollapsed,
    search: { active: s.search.active, everything: s.search.includeArchiveTrash, matchCase: s.search.matchCase, exactPhrase: s.search.exactPhrase },
    settingsOpen: s.settingsOpen,
    aboutOpen: s.aboutOpen,
    transientOpen: s.menuFor !== null || s.overrideFor !== null,
    dataOp: s.dataOp,
    remindersFull: atReminderLimit(Object.values(s.reminders)),
    undoOffered: visibleUndoToken(s.notifications) !== null,
    redoOffered: visibleRedoToken(s.notifications) !== null,
    // 016 FR-017: one safe link holds the editor's selection or cursor.
    linkAtCursor: (editor?.linkAddress?.() ?? null) !== null,
  };
}

export interface Publisher {
  /** Asks for a report at the next frame; several asks in one frame make one report. */
  schedule(): void;
  stop(): void;
}

export function createPublisher(
  send: (state: CommandState) => void,
  read: () => CommandStateInput = gatherInput,
  frame: (cb: () => void) => void = (cb) => {
    requestAnimationFrame(cb);
  },
): Publisher {
  let last: CommandState | null = null;
  let pending = false;
  let stopped = false;
  return {
    schedule() {
      if (pending || stopped) return;
      pending = true;
      frame(() => {
        pending = false;
        if (stopped) return;
        const next = commandState(read());
        if (sameState(last, next)) return;
        last = next;
        send(next);
      });
    },
    stop() {
      stopped = true;
    },
  };
}

/** Installed once at start: the store, the focus and the selection (pressed states) ask for a report. */
export function startPublishingState(): () => void {
  const publisher = createPublisher((state) => {
    void window.vesta.menu.setState(state);
  });
  const schedule = () => {
    publisher.schedule();
  };
  const off = useVesta.subscribe(schedule);
  document.addEventListener("focusin", schedule, true);
  document.addEventListener("focusout", schedule, true);
  document.addEventListener("selectionchange", schedule);
  schedule();
  return () => {
    publisher.stop();
    off();
    document.removeEventListener("focusin", schedule, true);
    document.removeEventListener("focusout", schedule, true);
    document.removeEventListener("selectionchange", schedule);
  };
}
