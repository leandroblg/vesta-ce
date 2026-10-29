// @vitest-environment jsdom
// 013 T021 (research §3): one report per frame, and none when nothing changed.
import { describe, expect, it, vi } from "vitest";
import type { CommandStateInput } from "../../../src/domain/menu/state";
import { commandState, sameState } from "../../../src/domain/menu/state";
import { createPublisher } from "../../../src/renderer/menu/publish-state";
import { budget } from "../perf-budget";

const base: CommandStateInput = {
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
};

function harness() {
  let input = base;
  const frames: (() => void)[] = [];
  const send = vi.fn();
  const publisher = createPublisher(
    send,
    () => input,
    (cb) => {
      frames.push(cb);
    },
  );
  return {
    publisher,
    send,
    set: (over: Partial<CommandStateInput>) => {
      input = { ...base, ...over };
    },
    flush: () => {
      while (frames.length > 0) frames.shift()?.();
    },
  };
}

describe("013 T021 the command state publisher", () => {
  it("store changes, focusin and focusout in one frame send one menu:set-state", () => {
    const h = harness();
    h.publisher.schedule();
    h.publisher.schedule();
    h.publisher.schedule();
    h.flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(sameState(h.send.mock.calls[0]?.[0] as never, commandState(base))).toBe(true);
  });

  it("an unchanged state sends nothing; a changed one sends again", () => {
    const h = harness();
    h.publisher.schedule();
    h.flush();
    h.publisher.schedule();
    h.flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    h.set({ view: "trash" });
    h.publisher.schedule();
    h.flush();
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it("nothing is sent after stop", () => {
    const h = harness();
    h.publisher.schedule();
    h.publisher.stop();
    h.flush();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("T087 commandState and sameState stay well under 0.5 ms", () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) sameState(commandState(base), commandState({ ...base, view: i % 2 === 0 ? "tasks" : "trash" }));
    expect((performance.now() - start) / 1000).toBeLessThan(budget(0.5));
  });
});
