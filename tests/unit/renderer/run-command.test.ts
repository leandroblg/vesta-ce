// @vitest-environment jsdom
// 013 T018 (research §2): each menu command runs the handler its toolbar, context menu, key or button runs.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  menuFor: null as string | null,
  overrideFor: null as string | null,
  panelFor: null as string | null,
  remindersCollapsed: false,
  settingsOpen: false,
  includeLogs: false,
  search: { includeArchiveTrash: false },
};
const actions = {
  openMenu: vi.fn((id: string | null) => {
    state.menuFor = id;
  }),
  openOverride: vi.fn((id: string | null) => {
    state.overrideFor = id;
  }),
  setView: vi.fn(),
  setRemindersCollapsed: vi.fn(() => Promise.resolve(true)),
  closePanel: vi.fn(),
  undo: vi.fn(() => Promise.resolve()),
  setSettingsPane: vi.fn(),
  exportData: vi.fn(() => Promise.resolve()),
  importData: vi.fn(() => Promise.resolve()),
  reschedule: vi.fn(() => Promise.resolve()),
  confirmDeletePermanently: vi.fn(() => Promise.resolve()),
  setIncludeArchiveTrash: vi.fn(),
  toggleMatchCase: vi.fn(),
  toggleExactPhrase: vi.fn(),
  openLogsFromNotice: vi.fn(),
  openLogViewer: vi.fn(),
  checkForUpdates: vi.fn(() => Promise.resolve()),
};
let focused: { id: string; kind: "task" | "rem" } | null = null;
const openHelp = vi.fn(() => Promise.resolve({ ok: true, value: null }));
(globalThis as { window: unknown }).window = Object.assign(globalThis.window, { vesta: { app: { openHelp } } });
const runAction = vi.fn(() => true);
const menuUndoRedo = vi.fn();
const openSettings = vi.fn();
const editor = { format: vi.fn(() => true) };
let liveEditor: typeof editor | null = editor;

vi.mock("../../../src/renderer/store/store", () => ({ actions, useVesta: { getState: () => state } }));
vi.mock("../../../src/renderer/keyboard/registry", () => ({ runAction, menuUndoRedo }));
vi.mock("../../../src/renderer/keyboard/handlers", () => ({ openSettings }));
vi.mock("../../../src/renderer/editor/active", () => ({ menuEditor: () => liveEditor }));
vi.mock("../../../src/renderer/keyboard/selection", () => ({
  selectedCard: () => focused,
  removeFromTrash: (_card: unknown, run: () => Promise<unknown>) => run(),
}));

const { runCommand, registerCommand } = await import("../../../src/renderer/menu/run-command");

beforeEach(() => {
  vi.clearAllMocks();
  state.menuFor = null;
  state.overrideFor = null;
  state.panelFor = null;
  state.remindersCollapsed = false;
  state.settingsOpen = false;
  liveEditor = editor;
  focused = null;
});

describe("013 research §2 runCommand", () => {
  it.each([
    ["newTask", "newTask"],
    ["newSub", "newSub"],
    ["newRem", "newRem"],
    ["find", "search"],
    ["done", "done"],
    ["trash", "del"],
    ["restore", "restore"],
    ["minimize", "minimize"],
  ])("FR-010 %s runs the registry's %s", (id, action) => {
    runCommand(id);
    expect(runAction).toHaveBeenCalledWith(action);
  });

  it("the view items switch views; Show Reminders toggles the section", () => {
    runCommand("view:archive");
    runCommand("view:trash");
    runCommand("view:tasks");
    expect(actions.setView.mock.calls).toEqual([["archive"], ["trash"], ["tasks"]]);
    runCommand("showReminders");
    expect(actions.setRemindersCollapsed).toHaveBeenCalledWith(true);
  });

  it("Show Details opens the selected item's panel, or closes the open one (PRD Q188)", () => {
    runCommand("showDetails");
    expect(runAction).toHaveBeenCalledWith("open");
    state.panelFor = "t1";
    runCommand("showDetails");
    expect(actions.closePanel).toHaveBeenCalledTimes(1);
    focused = { id: "t1", kind: "task" };
    runCommand("showDetails");
    expect(actions.closePanel).toHaveBeenCalledTimes(2);
    // US1-9: with another task focused, it shows that task instead of closing the panel.
    focused = { id: "t2", kind: "task" };
    runAction.mockClear();
    runCommand("showDetails");
    expect(actions.closePanel).toHaveBeenCalledTimes(2);
    expect(runAction).toHaveBeenCalledWith("open");
  });

  it("Undo, Redo and Settings do what menu:undo, menu:redo and menu:settings did", () => {
    runCommand("undo");
    runCommand("redo");
    expect(menuUndoRedo.mock.calls.map((c) => c[0] as boolean)).toEqual([false, true]);
    runCommand("settings");
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("FR-016 Format items run the active editor's floating-menu option; Outdent is Shift+Indent", () => {
    runCommand("fmt:strong");
    runCommand("fmt:heading-2");
    runCommand("fmt:outdent");
    expect(editor.format.mock.calls).toEqual([["strong"], ["heading-2"], ["indent", true]]);
    liveEditor = null;
    runCommand("fmt:emphasis");
    expect(editor.format).toHaveBeenCalledTimes(3);
  });

  it("CHK029 an open context menu or alert override closes first", () => {
    state.menuFor = "t1";
    runCommand("done");
    expect(actions.openMenu).toHaveBeenCalledWith(null);
    state.overrideFor = "t1";
    runCommand("done");
    expect(actions.openOverride).toHaveBeenCalledWith(null);
  });

  it("a registered command runs instead of the default routing; an unknown id is ignored", () => {
    const run = vi.fn();
    const off = registerCommand("about", run);
    runCommand("about");
    expect(run).toHaveBeenCalledTimes(1);
    off();
    runCommand("nope");
    runCommand(42);
    expect(runAction).not.toHaveBeenCalled();
  });

  it("T024 Export… and Import… open Settings at Data and start the operation", () => {
    runCommand("export");
    expect(actions.setSettingsPane).toHaveBeenCalledWith("data");
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(actions.exportData).toHaveBeenCalledWith(false);
    // T112 (FR-003, PRD Q189): with Settings open at Data and "include logs" ticked, the menu exports with them.
    state.settingsOpen = true;
    state.includeLogs = true;
    runCommand("export");
    expect(actions.exportData).toHaveBeenLastCalledWith(true);
    state.includeLogs = false;
    runCommand("import");
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(actions.importData).toHaveBeenCalledTimes(1);
  });

  it("T025, T027 Reschedule, Alert Period… and Delete Permanently… act on the focused card, else the panel's item", () => {
    focused = { id: "t1", kind: "task" };
    runCommand("reschedule");
    runCommand("alertPeriod");
    runCommand("deleteForever");
    expect(actions.reschedule).toHaveBeenCalledWith("t1");
    expect(actions.openOverride).toHaveBeenCalledWith("t1");
    expect(actions.confirmDeletePermanently).toHaveBeenCalledWith("t1");
    focused = null;
    state.panelFor = "p1";
    runCommand("reschedule");
    expect(actions.reschedule).toHaveBeenLastCalledWith("p1");
    state.panelFor = null;
    runCommand("reschedule");
    expect(actions.reschedule).toHaveBeenCalledTimes(2);
  });

  it("T026 (PRD Q180) Search Everything, Match Case and Exact Phrase toggle the scope bar's options", () => {
    runCommand("searchEverything");
    expect(actions.setIncludeArchiveTrash).toHaveBeenCalledWith(true);
    runCommand("matchCase");
    runCommand("exactPhrase");
    expect(actions.toggleMatchCase).toHaveBeenCalledTimes(1);
    expect(actions.toggleExactPhrase).toHaveBeenCalledTimes(1);
  });

  it("T028, T050 Show Logs and Check for Updates… open their pane", () => {
    runCommand("showLogs");
    expect(actions.openLogsFromNotice).toHaveBeenCalledTimes(1);
    expect(actions.openLogViewer).toHaveBeenCalledTimes(1);
    runCommand("checkUpdates");
    expect(actions.setSettingsPane).toHaveBeenCalledWith("updates");
    expect(actions.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("T029 Vesta Help and Release Notes ask main for their fixed URL", () => {
    runCommand("help");
    runCommand("releaseNotes");
    expect(openHelp.mock.calls).toEqual([[{ target: "readme" }], [{ target: "release" }]]);
  });
});
