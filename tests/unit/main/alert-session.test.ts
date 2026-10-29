import { describe, expect, it } from "vitest";
import { fakeClock } from "../../../src/domain/clock";
import { AlertSession } from "../../../src/main/alert-session";

describe("AlertSession: visibility of the main view (003 research §3)", () => {
  it("starts not visible, with no visibleSince", () => {
    const s = new AlertSession(fakeClock(1000));
    expect(s.visibility()).toEqual({ visible: false, visibleSince: null });
  });

  it("records when the main view became visible and keeps it while it stays visible", () => {
    const clock = fakeClock(1000);
    const s = new AlertSession(clock);
    s.report(true);
    expect(s.visibility()).toEqual({ visible: true, visibleSince: 1000 });
    clock.advance(60_000);
    s.report(true);
    expect(s.visibility()).toEqual({ visible: true, visibleSince: 1000 });
  });

  it("goes not visible, and a later report restarts visibleSince", () => {
    const clock = fakeClock(1000);
    const s = new AlertSession(clock);
    s.report(true);
    clock.advance(5000);
    s.report(false);
    expect(s.visibility().visible).toBe(false);
    clock.advance(5000);
    s.report(true);
    expect(s.visibility()).toEqual({ visible: true, visibleSince: 11_000 });
  });

  it("treats sleep as not visible: the first visible report after waking starts a new visibleSince", () => {
    const clock = fakeClock(1000);
    const s = new AlertSession(clock);
    s.report(true);
    clock.advance(1000);
    s.suspend();
    expect(s.visibility().visible).toBe(false);
    clock.advance(3_600_000);
    s.resume();
    expect(s.visibility().visible).toBe(false);
    s.report(true);
    expect(s.visibility()).toEqual({ visible: true, visibleSince: 3_602_000 });
  });

  it("ignores visible reports while suspended", () => {
    const clock = fakeClock(1000);
    const s = new AlertSession(clock);
    s.suspend();
    s.report(true);
    expect(s.visibility().visible).toBe(false);
  });

  it("needs the window shown and not minimized as well as the renderer's report (Electron may keep reporting visible)", () => {
    const clock = fakeClock(1000);
    const s = new AlertSession(clock);
    s.setWindowVisible(true);
    s.report(true);
    expect(s.visibility()).toEqual({ visible: true, visibleSince: 1000 });
    clock.advance(1000);
    s.setWindowVisible(false);
    expect(s.visibility().visible).toBe(false);
    s.report(true);
    expect(s.visibility().visible).toBe(false);
    clock.advance(1000);
    s.setWindowVisible(true);
    s.report(true);
    expect(s.visibility()).toEqual({ visible: true, visibleSince: 3000 });
  });
});
