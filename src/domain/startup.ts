/** What to do at start, decided from facts about the files (research.md §7, FR-042, FR-042a, FR-043). */
import type { StartupResult } from "./startup-outcome";

export interface StartupFacts {
  dataExists: boolean;
  /** The data file opens and passes integrity_check. */
  dataOk: boolean;
  dataVersion: number;
  latestVersion: number;
  /** Set when a planned upgrade was tried and failed; the plan is then made again. */
  upgradeFailed: boolean;
  backupExists: boolean;
  /** The backup passes integrity_check and is not newer than this app. */
  backupValid: boolean;
  backupAt: number | null;
}

export type StartupStep =
  | "preUpgradeBackup"
  | "migrate"
  | "restoreFromBackup"
  | "setAsideUnreferenced"
  | "keepDamagedCopy"
  | "startEmpty";

export interface StartupPlan {
  steps: StartupStep[];
  /** Paths and moved files are filled in by whoever carries out the plan. */
  result: StartupResult;
}

export function planStartup(f: StartupFacts): StartupPlan {
  if (!f.dataExists) return { steps: ["migrate"], result: { kind: "firstRun" } };
  if (f.dataOk && !f.upgradeFailed) {
    // 017 FR-015a (PRD Q263): a newer schema is refused before any other branch, so it is never restored over.
    if (f.dataVersion > f.latestVersion) return { steps: [], result: { kind: "newerData", dataVersion: f.dataVersion, latestVersion: f.latestVersion } };
    if (f.dataVersion < f.latestVersion) return { steps: ["preUpgradeBackup", "migrate"], result: { kind: "ok" } };
    return { steps: [], result: { kind: "ok" } };
  }
  if (f.backupValid) {
    return {
      steps: ["restoreFromBackup", "setAsideUnreferenced"],
      result: { kind: "restored", backupAt: f.backupAt ?? 0, moved: null },
    };
  }
  return {
    steps: ["keepDamagedCopy", "startEmpty"],
    result: f.backupExists ? { kind: "unrecoverable", damagedPath: "" } : { kind: "firstRun" },
  };
}
