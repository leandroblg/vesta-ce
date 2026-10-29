import { describe, expect, it, vi } from "vitest";
import { fakeClock } from "../../../../src/domain/clock";
import type { UpdateNotice } from "../../../../src/domain/settings";
import type { CheckOutcome } from "../../../../src/domain/updates/releases";
import { DAY_MS, HOUR_MS } from "../../../../src/domain/updates/schedule";
import { UpdateScheduler } from "../../../../src/main/updates/scheduler";
import type { UpdateState } from "../../../../src/shared/ipc-contract";

const T0 = Date.UTC(2026, 9, 19, 9, 0, 0);
const available = (version: string): CheckOutcome => ({
  kind: "available",
  release: { version, notes: "n", releaseUrl: `https://github.com/OWNER/vesta/releases/tag/v${version}`, fileUrl: null },
});

function setup(options: { auto?: boolean; notice?: UpdateNotice | null; outcomes?: CheckOutcome[] } = {}) {
  const clock = fakeClock(T0);
  const outcomes = [...(options.outcomes ?? [{ kind: "upToDate" }])];
  const check = vi.fn(() => Promise.resolve(outcomes.length > 1 ? (outcomes.shift() as CheckOutcome) : (outcomes[0] as CheckOutcome)));
  const states: UpdateState[] = [];
  const saved: UpdateNotice[] = [];
  const s = new UpdateScheduler({
    clock,
    check,
    running: "0.1.0",
    platform: "darwin",
    auto: options.auto ?? true,
    notice: options.notice ?? null,
    saveNotice: (n) => saved.push(n),
    onState: (st) => states.push(st),
    timer: { setInterval: () => 1, clearInterval: () => undefined },
  });
  return { s, clock, check, states, saved };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("UpdateScheduler (009 FR-021 to FR-027, research §10)", () => {
  it("checks only once started, then on its schedule: 24 h after a success, 1 h after a failure", async () => {
    const { s, clock, check } = setup({ outcomes: [{ kind: "upToDate" }, { kind: "failed", reason: "offline" }, { kind: "failed", reason: "offline" }, { kind: "upToDate" }] });
    await s.tick();
    expect(check).not.toHaveBeenCalled();
    s.start();
    await flush();
    expect(check).toHaveBeenCalledTimes(1);
    clock.advance(DAY_MS - 1);
    await s.tick();
    expect(check).toHaveBeenCalledTimes(1);
    clock.advance(1);
    await s.tick(); // fails
    expect(check).toHaveBeenCalledTimes(2);
    clock.advance(HOUR_MS);
    await s.tick(); // fails again
    clock.advance(HOUR_MS);
    await s.tick(); // succeeds
    expect(check).toHaveBeenCalledTimes(4);
    clock.advance(HOUR_MS);
    await s.tick();
    expect(check).toHaveBeenCalledTimes(4);
  });

  it("a manual check during an automatic one joins it; within a minute it repeats the last result (FR-022b, FR-027)", async () => {
    const { s, clock, check } = setup();
    s.start();
    const joined = await s.checkNow();
    expect(check).toHaveBeenCalledTimes(1);
    expect(joined.result).toEqual({ kind: "upToDate", checkedAt: T0 });
    clock.advance(30_000);
    expect((await s.checkNow()).result).toEqual({ kind: "upToDate", checkedAt: T0 });
    expect(check).toHaveBeenCalledTimes(1);
    clock.advance(30_000);
    await s.checkNow();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("with automatic checks off, nothing runs on its own; the button still checks; ticking the box checks at once", async () => {
    const { s, clock, check } = setup({ auto: false });
    s.start();
    await flush();
    clock.advance(3 * DAY_MS);
    await s.tick();
    expect(check).not.toHaveBeenCalled();
    await s.checkNow();
    expect(check).toHaveBeenCalledTimes(1);
    clock.advance(2 * 60_000);
    s.setAuto(true);
    await flush();
    expect(check).toHaveBeenCalledTimes(2);
    const off = s.setAuto(false);
    expect(off.auto).toBe(false);
  });

  it("announces a newer version once, with the mark, and stores it (FR-024, FR-024a)", async () => {
    const { s, states, saved } = setup({ outcomes: [available("0.2.0")] });
    s.start();
    await flush();
    await flush();
    const announced = states.filter((st) => st.announce !== null);
    expect(announced.map((st) => st.announce)).toEqual([{ version: "0.2.0" }]);
    expect(s.state()).toMatchObject({ mark: true, announce: null, result: { kind: "available", version: "0.2.0", hasFile: false, system: "macOS" } });
    expect(saved).toEqual([{ version: "0.2.0", seen: false }]);
    expect(s.links()).toEqual({ file: null, release: "https://github.com/OWNER/vesta/releases/tag/v0.2.0" });
    expect(s.updatesShown(true).mark).toBe(false);
    expect(saved[1]).toEqual({ version: "0.2.0", seen: true });
  });

  it("013 T114 FR-024: a version found while the Updates pane is shown is seen at once: no notice, no mark", async () => {
    const { s, states, saved, clock } = setup({ outcomes: [available("0.2.0"), available("0.3.0")] });
    s.updatesShown(true);
    s.start();
    await flush();
    await flush();
    expect(states.some((st) => st.announce !== null)).toBe(false);
    expect(states.some((st) => st.mark)).toBe(false);
    expect(saved).toEqual([{ version: "0.2.0", seen: true }]);
    // Once the pane is left, a later newer version is announced as usual.
    s.updatesShown(false);
    clock.advance(HOUR_MS); // past FR-022b's one-minute throttle
    await s.checkNow();
    await flush();
    expect(states.filter((st) => st.announce !== null).map((st) => st.announce)).toEqual([{ version: "0.3.0" }]);
    expect(s.state().mark).toBe(true);
  });

  it("does not announce a version stored as announced before (after a restart)", async () => {
    const { s, states } = setup({ notice: { version: "0.2.0", seen: true }, outcomes: [available("0.2.0")] });
    s.start();
    await flush();
    await flush();
    expect(states.some((st) => st.announce !== null)).toBe(false);
    expect(s.state().mark).toBe(false);
  });

  it("an automatic failure keeps a newer version found earlier; a manual one shows the failure", async () => {
    const { s, clock } = setup({ outcomes: [available("0.2.0"), { kind: "failed", reason: "offline" }, { kind: "failed", reason: "offline" }] });
    s.start();
    await flush();
    await flush();
    clock.advance(DAY_MS);
    await s.tick();
    expect(s.state().result.kind).toBe("available");
    clock.advance(2 * 60_000);
    expect((await s.checkNow()).result).toMatchObject({ kind: "failed", manual: true });
  });

  it("reports checking while a check runs", async () => {
    let release: (o: CheckOutcome) => void = () => undefined;
    const { s, states } = setup();
    (s as unknown as { deps: { check: () => Promise<CheckOutcome> } }).deps.check = () =>
      new Promise((r) => {
        release = r;
      });
    s.start();
    expect(s.state().checking).toBe(true);
    expect(states.at(-1)?.checking).toBe(true);
    release({ kind: "upToDate" });
    await flush();
    expect(s.state().checking).toBe(false);
  });
});

describe("Q133 the update reminder inside the scheduler (010 FR-033 to FR-035, research §10)", () => {
  const REMINDER_DAY = 86_400_000;
  function setupReminder(options: { auto?: boolean; on?: boolean; days?: number; anchor?: number | null; outcomes?: CheckOutcome[] } = {}) {
    const clock = fakeClock(T0);
    const outcomes = [...(options.outcomes ?? [{ kind: "upToDate" }])];
    const check = vi.fn(() => Promise.resolve(outcomes.length > 1 ? (outcomes.shift() as CheckOutcome) : (outcomes[0] as CheckOutcome)));
    const anchors: number[] = [];
    const reminders: number[] = [];
    const s = new UpdateScheduler({
      clock,
      check,
      running: "0.1.0",
      platform: "darwin",
      auto: options.auto ?? false,
      notice: null,
      saveNotice: () => undefined,
      onState: () => undefined,
      timer: { setInterval: () => 1, clearInterval: () => undefined },
      reminder: { on: options.on ?? true, days: options.days ?? 30, anchor: options.anchor === undefined ? null : options.anchor },
      saveReminderAnchor: (at) => anchors.push(at),
      onReminder: (at) => reminders.push(at),
    });
    return { s, clock, check, anchors, reminders };
  }

  it("Q133 setAuto(false) saves an anchor of now; turning it on clears it", () => {
    const { s, anchors } = setupReminder({ auto: true });
    s.setAuto(false);
    expect(anchors).toEqual([T0]);
    expect(s.reminderState()).toEqual({ on: true, days: 30, anchor: T0 });
    s.setAuto(true);
    expect(s.reminderState().anchor).toBeNull();
  });

  it("Q133 starting with automatic checks off and no anchor sets one at start", async () => {
    const { s, anchors } = setupReminder({ anchor: null });
    s.start();
    await flush();
    expect(anchors).toEqual([T0]);
  });

  it("Q133 a reminder is sent once the period has passed, then the anchor moves on", async () => {
    const { s, clock, anchors, reminders } = setupReminder({ anchor: T0 });
    s.start();
    await flush();
    clock.advance(30 * REMINDER_DAY - 1);
    await s.tick();
    expect(reminders).toEqual([]);
    clock.advance(1);
    await s.tick();
    expect(reminders).toEqual([T0 + 30 * REMINDER_DAY]);
    expect(anchors.at(-1)).toBe(T0 + 30 * REMINDER_DAY);
    await s.tick();
    expect(reminders).toHaveLength(1); // not twice
    clock.advance(30 * REMINDER_DAY);
    await s.tick();
    expect(reminders).toHaveLength(2);
  });

  it("Q133 no reminder while automatic checks are on, while the reminder is off, or before the period", async () => {
    const on = setupReminder({ auto: true, anchor: T0 });
    on.s.start();
    on.clock.advance(400 * REMINDER_DAY);
    await on.s.tick();
    expect(on.reminders).toEqual([]);
    const off = setupReminder({ on: false, anchor: T0 });
    off.s.start();
    off.clock.advance(400 * REMINDER_DAY);
    await off.s.tick();
    expect(off.reminders).toEqual([]);
    const early = setupReminder({ anchor: T0 });
    early.s.start();
    early.clock.advance(29 * REMINDER_DAY);
    await early.s.tick();
    expect(early.reminders).toEqual([]);
  });

  it("Q133 a completed check moves the anchor; a failed one does not", async () => {
    const { s, clock, check, anchors } = setupReminder({ anchor: T0, auto: false, outcomes: [{ kind: "failed", reason: "offline" }, { kind: "upToDate" }] });
    s.start();
    await flush();
    expect(check).not.toHaveBeenCalled(); // automatic checks are off
    clock.advance(2 * 60_000);
    await s.checkNow(); // fails
    expect(anchors).toEqual([]);
    clock.advance(2 * 60_000);
    await s.checkNow(); // succeeds
    expect(anchors).toEqual([T0 + 4 * 60_000]);
  });

  it("Q133 setReminderDays and setReminder change the rule at once", async () => {
    const { s, clock, reminders } = setupReminder({ anchor: T0 });
    s.start();
    expect(s.setReminderDays(7)).toEqual({ on: true, days: 7, anchor: T0 });
    clock.advance(7 * REMINDER_DAY);
    await s.tick();
    expect(reminders).toHaveLength(1);
    expect(s.setReminder(false).on).toBe(false);
    clock.advance(365 * REMINDER_DAY);
    await s.tick();
    expect(reminders).toHaveLength(1);
    s.setReminder(true); // starts a fresh period from now
    expect(s.reminderState().anchor).toBe(T0 + 372 * REMINDER_DAY);
  });

  it("Q133 a future anchor (clock moved back) counts as now", async () => {
    const { s, clock, anchors, reminders } = setupReminder({ anchor: T0 + 100 * REMINDER_DAY });
    s.start();
    await flush();
    expect(anchors).toEqual([T0]); // repaired and saved
    clock.advance(30 * REMINDER_DAY);
    await s.tick();
    expect(reminders).toEqual([T0 + 30 * REMINDER_DAY]);
  });
});
