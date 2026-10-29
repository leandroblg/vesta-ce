/**
 * Shortcut capture with the double Esc (007 FR-035, research §11): Esc can be captured; two Esc presses
 * within 1 s cancel; a single Esc is taken once the window passes; another key within the window replaces
 * the pending Esc. Time is passed in, so tests use a fake clock.
 */
import type { Combo } from "./combo";

export const ESC_WINDOW_MS = 1000;

export type CaptureState = { kind: "idle" } | { kind: "listening" } | { kind: "escPending"; since: number };
export type CaptureOutput = { kind: "none" } | { kind: "cancel" } | { kind: "combo"; combo: Combo };
export type CaptureInput = { key: Combo } | { tick: true };

const IDLE: CaptureState = { kind: "idle" };
const NONE: CaptureOutput = { kind: "none" };

export function captureStep(state: CaptureState, input: CaptureInput, now: number): [CaptureState, CaptureOutput] {
  if (state.kind === "idle") return [state, NONE];
  if (state.kind === "listening") {
    if ("tick" in input) return [state, NONE];
    if (input.key === "Escape") return [{ kind: "escPending", since: now }, NONE];
    return [IDLE, { kind: "combo", combo: input.key }];
  }
  const elapsed = now - state.since;
  if (elapsed >= ESC_WINDOW_MS) return [IDLE, { kind: "combo", combo: "Escape" }];
  if ("tick" in input) return [state, NONE];
  if (input.key === "Escape") return [IDLE, { kind: "cancel" }];
  return [IDLE, { kind: "combo", combo: input.key }];
}
