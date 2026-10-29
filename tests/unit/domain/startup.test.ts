import { describe, expect, it } from "vitest";
import { planStartup, type StartupFacts } from "../../../src/domain/startup";

const base: StartupFacts = {
  dataExists: true,
  dataOk: true,
  dataVersion: 1,
  latestVersion: 1,
  upgradeFailed: false,
  backupExists: true,
  backupValid: true,
  backupAt: 500,
};

describe("planStartup (research.md §7, FR-042, FR-042a, FR-043)", () => {
  it("healthy and current → ok, nothing to do", () => {
    expect(planStartup(base)).toEqual({ steps: [], result: { kind: "ok" } });
  });

  it("no data file → first run with a fresh database, no notice", () => {
    expect(planStartup({ ...base, dataExists: false, dataOk: false })).toEqual({ steps: ["migrate"], result: { kind: "firstRun" } });
  });

  it("healthy but older → back up first, then migrate (FR-043)", () => {
    expect(planStartup({ ...base, dataVersion: 0, latestVersion: 1 })).toEqual({
      steps: ["preUpgradeBackup", "migrate"],
      result: { kind: "ok" },
    });
  });

  it("corrupt with a valid backup → restore, set aside unused files (FR-042)", () => {
    expect(planStartup({ ...base, dataOk: false })).toEqual({
      steps: ["restoreFromBackup", "setAsideUnreferenced"],
      result: { kind: "restored", backupAt: 500, moved: null },
    });
  });

  it("failed upgrade with a valid backup → the same restore", () => {
    expect(planStartup({ ...base, dataVersion: 0, upgradeFailed: true }).steps).toEqual(["restoreFromBackup", "setAsideUnreferenced"]);
  });

  it("corrupt with an invalid backup → keep the damaged copy, start empty, unrecoverable (FR-042a)", () => {
    expect(planStartup({ ...base, dataOk: false, backupValid: false })).toEqual({
      steps: ["keepDamagedCopy", "startEmpty"],
      result: { kind: "unrecoverable", damagedPath: "" },
    });
  });

  it("corrupt with no backup file → first run, no notice, damaged copy kept (FR-042a)", () => {
    expect(planStartup({ ...base, dataOk: false, backupExists: false, backupValid: false, backupAt: null })).toEqual({
      steps: ["keepDamagedCopy", "startEmpty"],
      result: { kind: "firstRun" },
    });
  });

  it("a backup without a write time still restores, using time 0", () => {
    expect(planStartup({ ...base, dataOk: false, backupAt: null }).result).toEqual({ kind: "restored", backupAt: 0, moved: null });
  });
});

describe("data saved by a newer version (017 FR-015a, PRD Q263)", () => {
  it("newer data → refused: nothing to do, never a restore", () => {
    expect(planStartup({ ...base, dataVersion: 13, latestVersion: 12, backupValid: false })).toEqual({
      steps: [],
      result: { kind: "newerData", dataVersion: 13, latestVersion: 12 },
    });
    expect(planStartup({ ...base, dataVersion: 13, latestVersion: 12, backupValid: true })).toEqual({
      steps: [],
      result: { kind: "newerData", dataVersion: 13, latestVersion: 12 },
    });
  });

  it("the same version stays ok", () => {
    expect(planStartup({ ...base, dataVersion: 12, latestVersion: 12 })).toEqual({ steps: [], result: { kind: "ok" } });
  });

  it("damaged data keeps its restore path whatever version it claims", () => {
    expect(planStartup({ ...base, dataOk: false, dataVersion: 13, latestVersion: 12 }).steps).toEqual(["restoreFromBackup", "setAsideUnreferenced"]);
  });
});
