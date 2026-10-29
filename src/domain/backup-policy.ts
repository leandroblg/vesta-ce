/** Automatic backup timing (FR-041). The last write time survives restarts (backups/latest.json). */
export const BACKUP_INTERVAL_MS = 30 * 60_000;

export function isBackupDue(lastWrittenAt: number | null, now: number): boolean {
  return lastWrittenAt === null || now - lastWrittenAt >= BACKUP_INTERVAL_MS;
}
