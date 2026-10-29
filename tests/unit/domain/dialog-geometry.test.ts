/**
 * 016 dialogGeometry (research §11, data-model "Dialog geometry"; FR-036 to FR-039, PRD Q236, Q239, Q243, Q244, Q246,
 * Q254, Q258), replacing 015's settingsGeometry.
 */
import { describe, expect, it } from "vitest";
import { dialogGeometry, floorSize, nudge } from "../../../src/domain/dialog-geometry";

const WIN = { w: 1200, h: 800 };
const settings = (win: { w: number; h: number }, content: number, user: Parameters<typeof dialogGeometry>[0]["user"] = null) =>
  dialogGeometry({ win, content, user, share: 0.6, follow: true });
const logs = (win: { w: number; h: number }, user: Parameters<typeof dialogGeometry>[0]["user"] = null) =>
  dialogGeometry({ win, content: 0, user, share: 0.8, follow: false });

describe("016 Settings: the top edge where 60 % puts it, the width 60 %, the height following the pane (Q236, Q243)", () => {
  it("a short pane shrinks the dialog to its content, top edge still 20 % from the top", () => {
    expect(settings(WIN, 400)).toEqual({ x: 240, y: 160, w: 720, h: 400 });
  });
  it("never below the 320 px floor", () => {
    expect(settings(WIN, 120)).toEqual({ x: 240, y: 160, w: 720, h: 320 });
  });
  it("a tall pane grows downward to 70 % (its bottom 10 % above the window's), past that the pane scrolls (Q212)", () => {
    expect(settings(WIN, 520)).toEqual({ x: 240, y: 160, w: 720, h: 520 });
    expect(settings(WIN, 900)).toEqual({ x: 240, y: 160, w: 720, h: 560 });
  });
  it("the same top edge and width whatever the pane (SC-008)", () => {
    const a = settings(WIN, 330);
    const b = settings(WIN, 900);
    expect([a.x, a.y, a.w]).toEqual([b.x, b.y, b.w]);
  });
  it("Q244: in a narrow window the 360 × 320 floor wins over 60 % and every margin, up to the window's full width", () => {
    expect(settings({ w: 360, h: 420 }, 100)).toEqual({ x: 0, y: 84, w: 360, h: 320 });
    expect(settings({ w: 440, h: 600 }, 100)).toMatchObject({ w: 360, h: 320 });
    const r = settings({ w: 360, h: 420 }, 100);
    expect(r.y + r.h).toBe(404);
  });
});

describe("016 Logs: centered at 80 %, never below 360 × 320 (Q239, Q244)", () => {
  it("opens centered at 80 % of the window", () => {
    expect(logs({ w: 1280, h: 800 })).toEqual({ x: 128, y: 80, w: 1024, h: 640 });
  });
  it("the floor wins in a small window, never wider or taller than the window", () => {
    expect(logs({ w: 360, h: 420 })).toEqual({ x: 0, y: 42, w: 360, h: 336 });
    expect(logs({ w: 400, h: 380 })).toEqual({ x: 20, y: 30, w: 360, h: 320 });
  });
});

describe("016 moved or resized by hand, until it closes (FR-037, FR-039, Q246)", () => {
  it("a moved Settings keeps its place inside the window and still follows the pane's height from there", () => {
    expect(settings(WIN, 400, { x: 100, y: 60, w: null, h: null })).toEqual({ x: 100, y: 60, w: 720, h: 400 });
    expect(settings(WIN, 900, { x: 100, y: 60, w: null, h: null }).h).toBe(720 - 60);
    expect(settings(WIN, 400, { x: 900, y: -40, w: null, h: null })).toMatchObject({ x: 480, y: 0 });
  });
  it("a size set by hand, width and height, holds on every pane", () => {
    for (const content of [100, 400, 900]) {
      expect(settings(WIN, content, { x: 100, y: 100, w: 500, h: 400 })).toEqual({ x: 100, y: 100, w: 500, h: 400 });
    }
    expect(logs(WIN, { x: 10, y: 20, w: 600, h: 500 })).toEqual({ x: 10, y: 20, w: 600, h: 500 });
  });
  it("a size below the floor is raised to it", () => {
    expect(settings(WIN, 100, { x: 100, y: 100, w: 200, h: 100 })).toMatchObject({ w: 360, h: 320 });
  });
  it("FR-039: when the window gets smaller the dialog moves first, then shrinks, never below the floor", () => {
    expect(settings({ w: 900, h: 700 }, 100, { x: 700, y: 500, w: 500, h: 400 })).toEqual({ x: 400, y: 300, w: 500, h: 400 });
    expect(settings({ w: 400, h: 350 }, 100, { x: 700, y: 500, w: 500, h: 400 })).toEqual({ x: 0, y: 0, w: 400, h: 350 });
    expect(logs({ w: 360, h: 420 }, { x: 50, y: 50, w: 900, h: 900 })).toEqual({ x: 0, y: 0, w: 360, h: 420 });
  });
  it("floorSize is 360 × 320, or the whole window when that is smaller", () => {
    expect(floorSize({ w: 1200, h: 800 })).toEqual({ w: 360, h: 320 });
    expect(floorSize({ w: 300, h: 200 })).toEqual({ w: 300, h: 200 });
  });
});

describe("016 FR-038 the keyboard on the dialog's head (Q254, Q258)", () => {
  const rect = { x: 100, y: 100, w: 500, h: 400 };
  it("arrow keys move it 10 px", () => {
    expect(nudge(rect, { key: "ArrowRight", shift: false }, WIN)).toEqual({ x: 110, y: 100, w: 500, h: 400 });
    expect(nudge(rect, { key: "ArrowLeft", shift: false }, WIN)).toEqual({ x: 90, y: 100, w: 500, h: 400 });
    expect(nudge(rect, { key: "ArrowUp", shift: false }, WIN)).toEqual({ x: 100, y: 90, w: 500, h: 400 });
    expect(nudge(rect, { key: "ArrowDown", shift: false }, WIN)).toEqual({ x: 100, y: 110, w: 500, h: 400 });
  });
  it("Shift+arrow keys resize it 10 px from its bottom-right corner: Right and Down grow, Left and Up shrink", () => {
    expect(nudge(rect, { key: "ArrowRight", shift: true }, WIN)).toEqual({ x: 100, y: 100, w: 510, h: 400 });
    expect(nudge(rect, { key: "ArrowDown", shift: true }, WIN)).toEqual({ x: 100, y: 100, w: 500, h: 410 });
    expect(nudge(rect, { key: "ArrowLeft", shift: true }, WIN)).toEqual({ x: 100, y: 100, w: 490, h: 400 });
    expect(nudge(rect, { key: "ArrowUp", shift: true }, WIN)).toEqual({ x: 100, y: 100, w: 500, h: 390 });
  });
  it("stays within the window and never below the floor", () => {
    expect(nudge({ x: 0, y: 0, w: 360, h: 320 }, { key: "ArrowLeft", shift: false }, WIN)).toEqual({ x: 0, y: 0, w: 360, h: 320 });
    expect(nudge({ x: 0, y: 0, w: 360, h: 320 }, { key: "ArrowLeft", shift: true }, WIN)).toEqual({ x: 0, y: 0, w: 360, h: 320 });
    expect(nudge({ x: 840, y: 0, w: 360, h: 320 }, { key: "ArrowRight", shift: false }, WIN)?.x).toBe(840);
    expect(nudge({ x: 700, y: 0, w: 500, h: 320 }, { key: "ArrowRight", shift: true }, WIN)?.w).toBe(500);
  });
  it("other keys change nothing", () => {
    expect(nudge(rect, { key: "Enter", shift: false }, WIN)).toBeNull();
  });
});
