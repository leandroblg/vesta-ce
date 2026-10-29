/** 017 FR-009 (research §1): the macOS app is ad-hoc signed, with no Team ID, and not notarized. */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { artifact, missingBuild, releaseDir } from "./release";

describe.skipIf(missingBuild(artifact.mac) !== null)(missingBuild(artifact.mac) ?? "macOS signature (FR-009)", () => {
  let app = "";
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "vesta-mac-"));
    execFileSync("ditto", ["-x", "-k", join(releaseDir, artifact.mac), dir]);
    app = join(dir, "Vesta.app");
  });

  it("is signed ad hoc, with no Team ID", () => {
    const info = spawnSync("codesign", ["-dv", "--verbose=2", app], { encoding: "utf8" }).stderr;
    expect(info).toContain("Signature=adhoc");
    expect(info).toContain("TeamIdentifier=not set");
  });

  it("verifies as a whole bundle", () => {
    expect(spawnSync("codesign", ["--verify", "--deep", "--strict", app]).status).toBe(0);
  });

  it("carries no notarization ticket", () => {
    expect(spawnSync("xcrun", ["stapler", "validate", app]).status).not.toBe(0);
  });
});
