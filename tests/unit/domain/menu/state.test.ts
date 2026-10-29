import { describe, expect, it } from "vitest";
import {
  commandState,
  initialCommandState,
  sameState,
  type CommandStateInput,
  type FormatSnapshot,
  type Target,
} from "../../../../src/domain/menu/state";

const task: Target = { kind: "task", topLevel: true, stale: false };
const staleSub: Target = { kind: "subtask", topLevel: false, stale: true };

function input(over: Partial<CommandStateInput> = {}): CommandStateInput {
  return {
    view: "tasks",
    focused: null,
    panelItem: null,
    editorScope: null,
    textFocus: false,
    format: null,
    remindersCollapsed: false,
    search: { active: false, everything: false, matchCase: false, exactPhrase: false },
    settingsOpen: false,
    aboutOpen: false,
    transientOpen: false,
    dataOp: "idle",
    remindersFull: false,
    undoOffered: false,
    redoOffered: false,
    linkAtCursor: false,
    ...over,
  };
}

const snap: FormatSnapshot = { offered: ["strong"], pressed: [], disabled: [], heading: 0, inTable: false, tableActions: [] };

describe("013 data-model CommandState", () => {
  it("the focused card is the target, with its kind, level and staleness", () => {
    expect(commandState(input({ focused: staleSub })).target).toEqual(staleSub);
    expect(commandState(input()).target).toBeNull();
  });

  it("(OD4, Q182) with no focused card and panelFor set and no text focus, the panel's item is the target", () => {
    const s = commandState(input({ panelItem: task }));
    expect(s.target).toEqual(task);
    expect(s.panelOpen).toBe(true);
    expect(s.editing).toBe("none");
  });

  it("with a text field focused, the panel's item is still the target but editing is not none", () => {
    const s = commandState(input({ panelItem: task, editorScope: "details", format: snap }));
    expect(s.target).toEqual(task);
    expect(s.editing).toBe("details");
    expect(commandState(input({ panelItem: task, textFocus: true })).editing).toBe("text");
  });

  it("editing names the active editor's scope, and text for any other field", () => {
    expect(commandState(input({ editorScope: "title", format: snap })).editing).toBe("title");
    expect(commandState(input({ editorScope: "reminder", format: snap })).editing).toBe("reminder");
    expect(commandState(input({ textFocus: true })).editing).toBe("text");
  });

  it("format is null when not editing, whatever the input says", () => {
    expect(commandState(input({ format: snap })).format).toBeNull();
    expect(commandState(input({ editorScope: "details", format: snap })).format).toEqual(snap);
  });

  it("modal: settings before about before transient", () => {
    expect(commandState(input({ settingsOpen: true, aboutOpen: true })).modal).toBe("settings");
    expect(commandState(input({ aboutOpen: true, transientOpen: true })).modal).toBe("about");
    expect(commandState(input({ transientOpen: true })).modal).toBe("transient");
    expect(commandState(input()).modal).toBe("none");
  });

  it("busy while any data operation runs; reminders full and undo offered pass through", () => {
    expect(commandState(input({ dataOp: "importing" })).busy).toBe(true);
    expect(commandState(input({ dataOp: "exporting" })).busy).toBe(true);
    expect(commandState(input()).busy).toBe(false);
    expect(commandState(input({ remindersFull: true })).remindersFull).toBe(true);
    expect(commandState(input({ undoOffered: true })).undoOffered).toBe(true);
    expect(commandState(input({ remindersCollapsed: true })).remindersExpanded).toBe(false);
  });

  it("sameState compares structurally", () => {
    const a = commandState(input({ focused: task, editorScope: "details", format: snap }));
    const b = commandState(input({ focused: { ...task }, editorScope: "details", format: { ...snap, offered: ["strong"] } }));
    expect(sameState(a, b)).toBe(true);
    expect(sameState(a, commandState(input({ focused: staleSub })))).toBe(false);
    expect(sameState(a, { ...a, format: { ...snap, pressed: ["strong"] } })).toBe(false);
    expect(sameState(initialCommandState(), commandState(input()))).toBe(true);
    expect(sameState(null, null)).toBe(true);
    expect(sameState(a, null)).toBe(false);
  });
});
