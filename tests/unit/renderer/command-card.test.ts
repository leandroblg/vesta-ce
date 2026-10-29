// @vitest-environment jsdom
// 013 T102 (FR-015, PRD Q182): a menu command acts on the keyboard's selection, else on the task open in the panel;
// a key press acts only on the selection.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { panelFor: null as string | null, tasks: {} as Record<string, unknown> };
vi.mock("../../../src/renderer/store/store", () => ({
  actions: {},
  useVesta: { getState: () => state },
  NEW_TASK: "new-task",
  NEW_REMINDER: "new-rem",
  newSubKey: (id: string) => `new-sub:${id}`,
}));
vi.mock("../../../src/renderer/store/flush", () => ({ flushAll: () => Promise.resolve() }));
vi.mock("../../../src/renderer/keyboard/registry", () => ({ registerHandler: () => () => undefined }));

const { commandCard } = await import("../../../src/renderer/keyboard/selection");

beforeEach(() => {
  document.body.innerHTML = `<ul data-list="tasks"><li data-id="t1" data-kind="task"><input data-ctl="cb" type="checkbox"></li></ul><input id="other">`;
  state.panelFor = "t2";
  state.tasks = { t1: {}, t2: {} };
});

describe("013 FR-015 PRD Q182 what a menu command acts on", () => {
  it("the focused card first", () => {
    document.querySelector<HTMLInputElement>("[data-ctl='cb']")?.focus();
    expect(commandCard()).toEqual({ id: "t1", kind: "task" });
  });

  it("with no keyboard selection, the task open in the details panel, from the menu only", () => {
    document.getElementById("other")?.focus();
    expect(commandCard()).toEqual({ id: "t2", kind: "task" });
    expect(commandCard(new KeyboardEvent("keydown", { key: "Enter" }))).toBeNull();
  });

  it("nothing when no panel is open or its task is gone", () => {
    document.getElementById("other")?.focus();
    state.panelFor = null;
    expect(commandCard()).toBeNull();
    state.panelFor = "gone";
    expect(commandCard()).toBeNull();
  });
});
