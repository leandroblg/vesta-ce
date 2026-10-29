/**
 * The update check's schedule and state in main (009 FR-021 to FR-027, research §10). It ticks every minute on
 * real time against the app clock, and on resume from sleep; it runs one check at a time, keeps this session's
 * result, and announces a newer version at most once per version through `updateNotice`.
 */
import type { Clock } from "../../domain/clock";
import type { UpdateNotice } from "../../domain/settings";
import { decideAnnouncement, markShows } from "../../domain/updates/announce";
import { systemOf, type CheckOutcome, type FoundRelease } from "../../domain/updates/releases";
import { REMINDER_DAYS_DEFAULT } from "../../domain/limits";
import { anchorAfterClockBack, reminderDue } from "../../domain/updates/reminder";
import { afterAttempt, initialSchedule, isDue, mayRequest, type UpdateSchedule } from "../../domain/updates/schedule";
import type { UpdateResult, UpdateState } from "../../shared/ipc-contract";

export const TICK_MS = 60_000;

export interface SchedulerDeps {
  clock: Clock;
  check: () => Promise<CheckOutcome>;
  running: string;
  platform: string;
  auto: boolean;
  notice: UpdateNotice | null;
  saveNotice: (notice: UpdateNotice) => void;
  onState: (state: UpdateState) => void;
  timer?: { setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (h: unknown) => void };
  /** 010 Q133 (FR-033 to FR-035): the reminder while automatic checks are off, and where its anchor is kept. */
  reminder?: ReminderState;
  saveReminderAnchor?: (at: number) => void;
  onReminder?: (at: number) => void;
}

export interface ReminderState {
  on: boolean;
  days: number;
  /** The latest of: automatic checks turned off, the last completed check, the last reminder sent. */
  anchor: number | null;
}

export class UpdateScheduler {
  private schedule: UpdateSchedule;
  private result: UpdateResult = { kind: "none" };
  private found: FoundRelease | null = null;
  private notice: UpdateNotice | null;
  private announce: { version: string } | null = null;
  /** 013 T114: the renderer shows the Updates pane now. */
  private paneShown = false;
  private inflight: Promise<void> | null = null;
  private started = false;
  private handle: unknown = null;
  private reminder: ReminderState;

  constructor(private readonly deps: SchedulerDeps) {
    this.schedule = initialSchedule(deps.auto);
    this.notice = deps.notice;
    this.reminder = deps.reminder === undefined ? { on: true, days: REMINDER_DAYS_DEFAULT, anchor: null } : { ...deps.reminder };
  }

  /** On the window's load: the check at start, then every minute (FR-021). */
  start(): void {
    if (this.started) return;
    this.started = true;
    const timer = this.deps.timer ?? {
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (h: unknown) => {
        clearInterval(h as NodeJS.Timeout);
      },
    };
    this.handle = timer.setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  stop(): void {
    if (this.handle === null) return;
    (this.deps.timer?.clearInterval ?? ((h: unknown) => {
      clearInterval(h as NodeJS.Timeout);
    }))(this.handle);
    this.handle = null;
  }

  /** Also called on resume from sleep and by the test hook. */
  async tick(): Promise<void> {
    if (!this.started) return;
    const now = this.deps.clock.now();
    this.tickReminder(now);
    if (!isDue(this.schedule, now)) return;
    await this.run(false);
  }

  /**
   * 010 FR-033 (Q133): while automatic checks are off, a reminder is sent each time the period has passed since
   * the anchor; sending it starts the next period. A missing anchor is set now; a future one counts as now (003 Q99).
   */
  private tickReminder(now: number): void {
    if (this.schedule.auto) return;
    if (this.reminder.anchor === null) {
      if (!this.reminder.on) return;
      this.setAnchor(now);
      return;
    }
    const repaired = anchorAfterClockBack(this.reminder.anchor, now);
    if (repaired !== this.reminder.anchor) this.setAnchor(repaired);
    if (reminderDue({ auto: false, on: this.reminder.on, days: this.reminder.days, anchor: this.reminder.anchor }, now)) {
      this.deps.onReminder?.(now);
      this.setAnchor(now);
    }
  }

  private setAnchor(at: number): void {
    this.reminder = { ...this.reminder, anchor: at };
    this.deps.saveReminderAnchor?.(at);
  }

  reminderState(): ReminderState {
    return { ...this.reminder };
  }

  /** "Remind me to check for updates": turning it on starts a fresh period from now (FR-034). */
  setReminder(on: boolean): ReminderState {
    this.reminder = { ...this.reminder, on };
    if (on && !this.schedule.auto) this.setAnchor(this.deps.clock.now());
    return this.reminderState();
  }

  /** The period in days, 7 to 365; the next reminder is due the new period after the last anchor (FR-034). */
  setReminderDays(days: number): ReminderState {
    this.reminder = { ...this.reminder, days };
    return this.reminderState();
  }

  /** Check for updates (FR-021): joins a running check; within a minute of the last one, repeats its result. */
  async checkNow(): Promise<UpdateState> {
    if (this.inflight !== null) await this.inflight;
    else if (mayRequest(this.schedule, this.deps.clock.now())) await this.run(true);
    return this.state();
  }

  /**
   * FR-021a: off drops what is waiting; on checks at once (a minute after the last request at the soonest).
   * Synchronous, so the setting's channel ends a pending Undo import offer like every setting write.
   */
  setAuto(on: boolean): UpdateState {
    this.schedule = { ...this.schedule, auto: on, dueNow: on };
    // 010 FR-033 (Q133): off starts the reminder period now; on clears it (no reminder while automatic checks run).
    if (on) this.reminder = { ...this.reminder, anchor: null };
    else this.setAnchor(this.deps.clock.now());
    this.emit();
    if (on && this.started) void this.tick();
    return this.state();
  }

  /**
   * 013 FR-024 (PRD Q176): the Updates pane was shown, so the version known now counts as seen; while it stays
   * shown, a version found counts as seen at once (research §8, T114). `false` when the pane goes.
   */
  updatesShown(shown: boolean): UpdateState {
    this.paneShown = shown;
    if (shown && this.notice !== null && !this.notice.seen) {
      this.notice = { ...this.notice, seen: true };
      this.deps.saveNotice(this.notice);
      this.emit();
    }
    return this.state();
  }

  /** The checked addresses the Download links open (FR-024b). */
  links(): { file: string | null; release: string | null } {
    return { file: this.found?.fileUrl ?? null, release: this.found?.releaseUrl ?? null };
  }

  state(): UpdateState {
    return {
      checking: this.inflight !== null,
      auto: this.schedule.auto,
      result: this.result,
      mark: markShows(this.notice, this.deps.running),
      announce: this.announce,
    };
  }

  private run(manual: boolean): Promise<void> {
    if (this.inflight !== null) return this.inflight;
    this.schedule = { ...this.schedule, running: true };
    const work = (async () => {
      const startedAt = this.deps.clock.now();
      const outcome = await this.deps.check();
      const now = this.deps.clock.now();
      this.schedule = afterAttempt(this.schedule, startedAt, outcome.kind !== "failed");
      // 010 FR-033 (Q133): a completed check restarts the reminder period.
      if (outcome.kind !== "failed" && !this.schedule.auto) this.setAnchor(now);
      if (outcome.kind === "available") {
        this.found = outcome.release;
        const r = outcome.release;
        this.result = { kind: "available", checkedAt: now, version: r.version, notes: r.notes, hasFile: r.fileUrl !== null, system: systemOf(this.deps.platform) };
        const decision = decideAnnouncement(this.notice, r.version, this.deps.running, this.paneShown);
        if (decision.store !== null) {
          this.notice = decision.store;
          this.deps.saveNotice(decision.store);
        }
        if (decision.notify) this.announce = { version: r.version };
      } else if (outcome.kind === "upToDate") {
        this.result = { kind: "upToDate", checkedAt: now };
      } else if (manual || this.result.kind !== "available") {
        // An automatic failure never hides a newer version found earlier in this session.
        this.result = { kind: "failed", checkedAt: now, manual };
      }
    })().finally(() => {
      this.inflight = null;
      this.schedule = { ...this.schedule, running: false };
      this.emit();
      this.announce = null;
    });
    this.inflight = work;
    this.emit(); // checking: true
    return work;
  }

  private emit(): void {
    this.deps.onState(this.state());
  }
}
