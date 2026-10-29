import { describe, expect, it } from "vitest";
import { BACKUP_INTERVAL_MS, isBackupDue } from "../../../src/domain/backup-policy";

describe("isBackupDue (FR-041)", () => {
  it("is due when there is no backup yet", () => {
    expect(isBackupDue(null, 5)).toBe(true);
  });

  it("is due once 30 minutes have passed since the last backup", () => {
    expect(BACKUP_INTERVAL_MS).toBe(30 * 60_000);
    expect(isBackupDue(1000, 1000 + BACKUP_INTERVAL_MS - 1)).toBe(false);
    expect(isBackupDue(1000, 1000 + BACKUP_INTERVAL_MS)).toBe(true);
  });

  it("is not made due early by a clock that moved backwards", () => {
    expect(isBackupDue(10_000_000, 1000)).toBe(false);
  });
});
