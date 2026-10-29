/** The latest undoable action, in memory only (FR-028): replaced by the next one, lost on quit. */
import type { Clock } from "../domain/clock";
import type { UndoRecordKind } from "../domain/undo";
import type { Task } from "../domain/task";
import type { Reminder } from "../domain/reminder";
import type { ReminderUndoInput, UndoInput } from "../domain/undo";
import { UndoExpiredError } from "./ipc/result";

/** 10 s on screen plus 1 s of slack for the IPC round trip (research.md §5). */
export const UNDO_TTL_MS = 11_000;

type UndoRecord = (UndoInput | ReminderUndoInput) & {
  token: string;
  createdAt: number;
};

/** 016 FR-004 (research §1): what an undone reschedule needs to be redone. */
export interface RedoRecord {
  token: string;
  taskId: string;
  /** The duration the undone reschedule recorded, applied again from the Redo's moment. */
  forMin: number;
  createdAt: number;
}

export class UndoStore {
  private latest: UndoRecord | null = null;
  private redo: RedoRecord | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly newToken: () => string,
  ) {}

  /** `eventIds`: the history events the action recorded, which the undo removes (015 FR-019, PRD Q215). */
  put(kind: UndoRecordKind, before: readonly Task[], eventIds: readonly string[] = []): string {
    const token = this.newToken();
    this.latest = { token, kind, before, eventIds, createdAt: this.clock.now() };
    this.redo = null;
    return token;
  }

  /** A reminder action: replaces any earlier record, task or reminder (002 FR-014). */
  putReminder(kind: UndoRecordKind, before: readonly Reminder[]): string {
    const token = this.newToken();
    this.latest = { subject: "reminder", token, kind, before, createdAt: this.clock.now() };
    this.redo = null;
    return token;
  }

  take(token: string): UndoInput | ReminderUndoInput {
    const record = this.latest;
    if (record?.token !== token || this.clock.now() - record.createdAt >= UNDO_TTL_MS) throw new UndoExpiredError();
    this.latest = null;
    return record;
  }

  /** 016 FR-003: after the undo of a reschedule, its redo replaces every earlier record. */
  putRedo(taskId: string, forMin: number): string {
    const token = this.newToken();
    this.latest = null;
    this.redo = { token, taskId, forMin, createdAt: this.clock.now() };
    return token;
  }

  takeRedo(token: string): RedoRecord {
    const record = this.redo;
    if (record?.token !== token || this.clock.now() - record.createdAt >= UNDO_TTL_MS) throw new UndoExpiredError();
    this.redo = null;
    return record;
  }

  /** 016 FR-006 (PRD Q256): any other change to the list ends the offer. */
  clearRedo(): void {
    this.redo = null;
  }
}
