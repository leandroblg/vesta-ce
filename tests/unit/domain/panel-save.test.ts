import { describe, expect, it } from "vitest";
import { fakeClock } from "../../../src/domain/clock";
import {
  DEBOUNCE_MS,
  SAVED_MS,
  initialPanelSave,
  nextWakeAt,
  panelSaveView,
  step,
  type PanelSave,
  type PanelSaveEvent,
} from "../../../src/domain/panel-save";

/** Runs events in order, collecting the saves the machine asks for. */
function drive(events: PanelSaveEvent[], from: PanelSave = initialPanelSave()) {
  let state = from;
  let saves = 0;
  for (const event of events) {
    const out = step(state, event);
    state = out.state;
    saves += out.effects.length;
  }
  return { state, saves };
}

describe("panel save state machine (005 data-model.md, FR-009, FR-010)", () => {
  it("an edit goes pending, and saving starts 500 ms later", () => {
    const clock = fakeClock(1000);
    let { state } = drive([{ type: "edit", now: clock.now() }]);
    let saves: number;
    expect(panelSaveView(state).state).toBe("pending");
    expect(nextWakeAt(state)).toBe(1000 + DEBOUNCE_MS);
    ({ state, saves } = drive([{ type: "timer", now: 1000 + DEBOUNCE_MS - 1 }], state));
    expect(saves).toBe(0);
    expect(panelSaveView(state).state).toBe("pending");
    ({ state, saves } = drive([{ type: "timer", now: 1000 + DEBOUNCE_MS }], state));
    expect(saves).toBe(1);
    expect(panelSaveView(state).state).toBe("saving");
  });

  it("a second edit within 500 ms restarts the wait", () => {
    const { state, saves } = drive([
      { type: "edit", now: 0 },
      { type: "edit", now: 400 },
      { type: "timer", now: 500 },
    ]);
    expect(saves).toBe(0);
    expect(nextWakeAt(state)).toBe(900);
    expect(drive([{ type: "timer", now: 900 }], state).saves).toBe(1);
  });

  it("an ok reply shows saved for 3 s, then idle", () => {
    let { state } = drive([
      { type: "edit", now: 0 },
      { type: "timer", now: 500 },
      { type: "reply", ok: true, now: 600 },
    ]);
    expect(panelSaveView(state)).toEqual({ state: "saved", failedSticky: false });
    expect(nextWakeAt(state)).toBe(600 + SAVED_MS);
    ({ state } = drive([{ type: "timer", now: 600 + SAVED_MS - 1 }], state));
    expect(panelSaveView(state).state).toBe("saved");
    ({ state } = drive([{ type: "timer", now: 600 + SAVED_MS }], state));
    expect(panelSaveView(state)).toEqual({ state: "idle", failedSticky: false });
    expect(nextWakeAt(state)).toBeNull();
  });

  it("a failed reply is failed and stays until an ok reply", () => {
    let { state } = drive([
      { type: "edit", now: 0 },
      { type: "timer", now: 500 },
      { type: "reply", ok: false, now: 600 },
      { type: "timer", now: 100_000 },
    ]);
    expect(panelSaveView(state)).toEqual({ state: "failed", failedSticky: true });
    ({ state } = drive([{ type: "edit", now: 100_001 }], state));
    expect(panelSaveView(state)).toEqual({ state: "pending", failedSticky: true });
    ({ state } = drive([{ type: "timer", now: 100_501 }], state));
    expect(panelSaveView(state)).toEqual({ state: "saving", failedSticky: true });
    ({ state } = drive([{ type: "reply", ok: true, now: 100_600 }], state));
    expect(panelSaveView(state)).toEqual({ state: "saved", failedSticky: false });
  });

  it("an edit while saving queues exactly one more save", () => {
    let { state, saves } = drive([
      { type: "edit", now: 0 },
      { type: "timer", now: 500 },
      { type: "edit", now: 550 },
      { type: "edit", now: 560 },
      { type: "timer", now: 2000 },
    ]);
    expect(saves).toBe(1);
    expect(panelSaveView(state).state).toBe("saving");
    ({ state, saves } = drive([{ type: "reply", ok: true, now: 2100 }], state));
    expect(saves).toBe(1);
    expect(panelSaveView(state).state).toBe("saving");
    ({ state, saves } = drive([{ type: "reply", ok: true, now: 2200 }], state));
    expect(saves).toBe(0);
    expect(panelSaveView(state).state).toBe("saved");
  });

  it("closing while pending sends the save at once and shows no indicator afterwards", () => {
    let { state, saves } = drive([
      { type: "edit", now: 0 },
      { type: "close", now: 100 },
    ]);
    expect(saves).toBe(1);
    expect(panelSaveView(state)).toEqual({ state: "idle", failedSticky: false });
    expect(nextWakeAt(state)).toBeNull();
    // The flushed save's reply arrives after close: still no indicator.
    ({ state, saves } = drive([{ type: "reply", ok: false, now: 200 }], state));
    expect(panelSaveView(state)).toEqual({ state: "idle", failedSticky: false });
    expect(saves).toBe(0);
  });

  it("closing with nothing pending sends nothing", () => {
    expect(drive([{ type: "close", now: 0 }]).saves).toBe(0);
    expect(
      drive([
        { type: "edit", now: 0 },
        { type: "timer", now: 500 },
        { type: "close", now: 510 },
      ]).saves,
    ).toBe(1);
  });
});
