// 013 T063 (FR-042, FR-045; research §15, §17): one long-press helper for Table and Highlight.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { longPress } from "../../../src/renderer/editor/menu/long-press";

const pointer = (target: EventTarget, type: string, button = 0) => target.dispatchEvent(new PointerEvent(type, { button, bubbles: true }));

describe("013 the long press", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("runs onLong after 500 ms of a primary press, and not on a shorter one", () => {
    const button = document.body.appendChild(document.createElement("button"));
    const onLong = vi.fn();
    const lp = longPress(button, onLong);
    pointer(button, "pointerdown");
    vi.advanceTimersByTime(300);
    pointer(button, "pointerup");
    vi.advanceTimersByTime(500);
    expect(onLong).not.toHaveBeenCalled();
    expect(lp.consumeClick()).toBe(false);
    pointer(button, "pointerdown");
    vi.advanceTimersByTime(500);
    expect(onLong).toHaveBeenCalledTimes(1);
    pointer(button, "pointerdown", 2);
    vi.advanceTimersByTime(600);
    expect(onLong).toHaveBeenCalledTimes(1);
  });

  it("swallows the click that ends a long press on the button, once", () => {
    const button = document.body.appendChild(document.createElement("button"));
    const lp = longPress(button, vi.fn());
    pointer(button, "pointerdown");
    vi.advanceTimersByTime(500);
    pointer(button, "pointerup");
    expect(lp.consumeClick()).toBe(true);
    expect(lp.consumeClick()).toBe(false);
    pointer(button, "pointerdown");
    vi.advanceTimersByTime(500);
    pointer(button, "pointerdown");
    expect(lp.consumeClick()).toBe(false);
  });

  it("015 FR-007 with leaveCancels, leaving the button before the delay cancels the press; without it, it does not", () => {
    const button = document.body.appendChild(document.createElement("button"));
    const onLong = vi.fn();
    longPress(button, onLong, undefined, { leaveCancels: true });
    pointer(button, "pointerdown");
    vi.advanceTimersByTime(300);
    pointer(button, "pointerleave");
    vi.advanceTimersByTime(500);
    expect(onLong).not.toHaveBeenCalled();

    const table = document.body.appendChild(document.createElement("button"));
    const onTable = vi.fn();
    longPress(table, onTable);
    pointer(table, "pointerdown");
    pointer(table, "pointerleave");
    vi.advanceTimersByTime(500);
    expect(onTable).toHaveBeenCalledTimes(1);
  });

  it("T107 a long press released off the button swallows nothing, so a later keyboard click acts", () => {
    const button = document.body.appendChild(document.createElement("button"));
    const elsewhere = document.body.appendChild(document.createElement("div"));
    const onLong = vi.fn();
    const lp = longPress(button, onLong);
    pointer(button, "pointerdown");
    vi.advanceTimersByTime(500);
    expect(onLong).toHaveBeenCalledTimes(1);
    pointer(elsewhere, "pointerup");
    // The next click is Enter or Space on the button: no pointerdown comes first.
    expect(lp.consumeClick()).toBe(false);
  });

  it("T107 a short press released off the button cancels the long press", () => {
    const button = document.body.appendChild(document.createElement("button"));
    const elsewhere = document.body.appendChild(document.createElement("div"));
    const onLong = vi.fn();
    const lp = longPress(button, onLong);
    pointer(button, "pointerdown");
    vi.advanceTimersByTime(200);
    pointer(elsewhere, "pointerup");
    vi.advanceTimersByTime(600);
    expect(onLong).not.toHaveBeenCalled();
    expect(lp.consumeClick()).toBe(false);
  });

  it("pointercancel cancels the press; destroy removes the listeners", () => {
    const button = document.body.appendChild(document.createElement("button"));
    const onLong = vi.fn();
    const lp = longPress(button, onLong);
    pointer(button, "pointerdown");
    pointer(button, "pointercancel");
    vi.advanceTimersByTime(600);
    expect(onLong).not.toHaveBeenCalled();
    lp.destroy();
    pointer(button, "pointerdown");
    vi.advanceTimersByTime(600);
    expect(onLong).not.toHaveBeenCalled();
  });
});
