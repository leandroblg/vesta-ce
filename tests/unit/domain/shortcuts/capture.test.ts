import { describe, expect, it } from "vitest";
import { ESC_WINDOW_MS, captureStep, type CaptureState } from "../../../../src/domain/shortcuts/capture";

const listening: CaptureState = { kind: "listening" };

describe("captureStep (007 FR-035, research §11)", () => {
  it("has a fixed 1 s window", () => {
    expect(ESC_WINDOW_MS).toBe(1000);
  });

  it("cancels on two Esc presses within the window", () => {
    const [pending] = captureStep(listening, { key: "Escape" }, 0);
    expect(pending).toEqual({ kind: "escPending", since: 0 });
    expect(captureStep(pending, { key: "Escape" }, 999)).toEqual([{ kind: "idle" }, { kind: "cancel" }]);
  });

  it("assigns Esc when the window passes with no other key", () => {
    const [pending] = captureStep(listening, { key: "Escape" }, 0);
    expect(captureStep(pending, { tick: true }, 999)).toEqual([pending, { kind: "none" }]);
    expect(captureStep(pending, { tick: true }, 1000)).toEqual([{ kind: "idle" }, { kind: "combo", combo: "Escape" }]);
  });

  it("takes another key pressed within the window and drops the pending Esc", () => {
    const [pending] = captureStep(listening, { key: "Escape" }, 0);
    expect(captureStep(pending, { key: "Mod+N" }, 400)).toEqual([{ kind: "idle" }, { kind: "combo", combo: "Mod+N" }]);
  });

  it("takes any other key at once", () => {
    expect(captureStep(listening, { key: "F5" }, 10)).toEqual([{ kind: "idle" }, { kind: "combo", combo: "F5" }]);
  });

  it("never resolves a pending Esc while time does not pass", () => {
    const [pending] = captureStep(listening, { key: "Escape" }, 500);
    expect(captureStep(pending, { tick: true }, 500)).toEqual([pending, { kind: "none" }]);
  });

  it("does nothing when not capturing", () => {
    expect(captureStep({ kind: "idle" }, { key: "F5" }, 0)).toEqual([{ kind: "idle" }, { kind: "none" }]);
  });
});
