/** What the renderer is told about how the app started (data-model.md, FR-038a, FR-042, FR-042a). */
export type StartupResult =
  | { kind: "ok" }
  | { kind: "firstRun" }
  | { kind: "restored"; backupAt: number; moved: { count: number; folder: string } | null }
  | { kind: "unrecoverable"; damagedPath: string }
  /** 017 FR-015a (PRD Q263): data saved by a newer Vesta; refused, never migrated, backed up over or restored over. */
  | { kind: "newerData"; dataVersion: number; latestVersion: number };

/** 010 FR-026: `abnormalExitAt` is the time of a previous uncaught exception, read from the marker at start. */
export type StartupOutcome = StartupResult & { folderNotWritable: boolean; dataDir: string; abnormalExitAt: number | null };
