// @vitest-environment jsdom
// 018 FR-037, T076 (T086): moving or pressing the pointer in a group of time fields neither saves nor restarts the
// 2 s wait; only keystrokes, moves of the focus between its fields, leaving it and Enter count.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimeGroupSave, type SaveHow, type TimeGroupSaver } from "../../../src/renderer/features/settings/useTimeGroupSave";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useTimeGroupSave and the pointer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("pointer events inside the group change nothing", () => {
    const saved: [number, SaveHow][] = [];
    let saver: TimeGroupSaver<number> | null = null;
    function Group() {
      const g = useTimeGroupSave<number>((v, how) => {
        saved.push([v, how]);
      });
      saver = g.saver;
      return createElement("fieldset", { ...g.groupProps, "data-testid": "g" }, createElement("input", { id: "d" }), createElement("input", { id: "h" }));
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(createElement(Group));
    });
    const d = document.getElementById("d") as HTMLInputElement;
    const h = document.getElementById("h") as HTMLInputElement;
    act(() => {
      d.focus();
    });
    (saver as TimeGroupSaver<number> | null)?.offer(5);
    vi.advanceTimersByTime(1500);
    for (const target of [d, h, host.firstElementChild as HTMLElement]) {
      for (const type of ["pointerover", "pointerenter", "pointermove", "pointerdown", "mousedown", "pointerup", "mouseup", "pointerleave"]) {
        act(() => {
          target.dispatchEvent(new MouseEvent(type, { bubbles: true }));
        });
      }
    }
    expect(saved).toEqual([]);
    // The wait was not restarted: the save comes 2 s after the offer.
    vi.advanceTimersByTime(500);
    expect(saved).toEqual([[5, "idle"]]);
    act(() => {
      root.unmount();
    });
    expect(saved).toHaveLength(1);
  });
});
