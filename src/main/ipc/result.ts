/** Turns an action's outcome into a Result and logs failed saves (FR-040). */
import { DomainError } from "../../domain/task";
import type { Result } from "../../shared/ipc-contract";
import { SaveFailedError } from "../db/tasks-repo";
import type { Logger } from "../log";
import { errorMessage } from "../log";
import { AssetError } from "../assets/store";

export class UndoExpiredError extends Error {
  constructor() {
    super("The undo is no longer available");
    this.name = "UndoExpiredError";
  }
}

export function toResult<T>(action: string, ids: readonly string[], fn: () => T, log: Logger): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    if (err instanceof DomainError || err instanceof AssetError) {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    if (err instanceof UndoExpiredError) return { ok: false, error: { code: "UNDO_EXPIRED", message: err.message } };
    const message = errorMessage(err);
    // 009 FR-001, SC-002: one entry per failure, with the trace of an unexpected error in it.
    const stack = !(err instanceof SaveFailedError) && err instanceof Error ? (err.stack ?? null) : null;
    log.error("save.failed", { action, ids: [...ids], message, ...(stack === null ? {} : { stack }) });
    return { ok: false, error: { code: "SAVE_FAILED", message } };
  }
}
