// T015: main's update state becomes at most one update notice per version (009 FR-024, FR-024a).
import { describe, expect, it } from "vitest";
import type { UpdateState } from "../../../src/shared/ipc-contract";
import { planReminder, planUpdateNotice } from "../../../src/renderer/store/update-state";

const state = (announce: string | null): UpdateState => ({
  checking: false,
  auto: true,
  result: announce === null ? { kind: "upToDate", checkedAt: 1 } : { kind: "available", checkedAt: 1, version: announce, notes: "", hasFile: true, system: "macOS" },
  mark: announce !== null,
  announce: announce === null ? null : { version: announce },
});

describe("planUpdateNotice", () => {
  it("turns an announcement into exactly one notice", () => {
    const first = planUpdateNotice(state("0.2.0"), null, false);
    expect(first).toEqual({ notify: "0.2.0", queued: "0.2.0" });
    expect(planUpdateNotice(state("0.2.0"), first.queued, false)).toEqual({ notify: null, queued: "0.2.0" });
  });

  it("announces a newer version again", () => {
    expect(planUpdateNotice(state("0.3.0"), "0.2.0", false)).toEqual({ notify: "0.3.0", queued: "0.3.0" });
  });

  it("shows nothing for a state without an announcement, or while Settings is open", () => {
    expect(planUpdateNotice(state(null), null, false)).toEqual({ notify: null, queued: null });
    expect(planUpdateNotice(state("0.2.0"), null, true)).toEqual({ notify: null, queued: null });
  });
});

describe("planReminder (010 FR-033, Q133; convergence T089)", () => {
  it("Q133 a reminder due while Settings is open waits and shows when Settings closes", () => {
    const due = planReminder("due", { settingsOpen: true, queued: false });
    expect(due).toEqual({ show: false, queued: true });
    expect(planReminder("settingsClosed", { settingsOpen: false, queued: due.queued })).toEqual({ show: true, queued: false });
    // Nothing waiting: closing Settings shows nothing.
    expect(planReminder("settingsClosed", { settingsOpen: false, queued: false })).toEqual({ show: false, queued: false });
  });

  it("Q133 a reminder due while Settings is closed shows at once and queues nothing", () => {
    expect(planReminder("due", { settingsOpen: false, queued: false })).toEqual({ show: true, queued: false });
    // A second due while one already waits (Settings open the whole time) keeps one reminder.
    expect(planReminder("due", { settingsOpen: true, queued: true })).toEqual({ show: false, queued: true });
  });

  it("Q133 a completed check while the reminder waits drops it", () => {
    expect(planReminder("checked", { settingsOpen: true, queued: true })).toEqual({ show: false, queued: false });
    expect(planReminder("checked", { settingsOpen: false, queued: false })).toEqual({ show: false, queued: false });
  });
});
