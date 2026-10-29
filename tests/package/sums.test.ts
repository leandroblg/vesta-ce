/** 017 FR-005, FR-007, FR-020, SC-002: the handout folder is exactly the handout, and its checksums match. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handoutFiles } from "../../scripts/lib/package-steps.ts";
import { checkSums } from "../../scripts/lib/sums.ts";
import { artifact, handoutDir, missingBuild, releaseDir, version } from "./release";

const sums = join("handout", "SHA256SUMS");
describe.skipIf(missingBuild(sums) !== null)(missingBuild(sums) ?? "handout and checksums", () => {
  it("every file has its line and every hash matches", async () => {
    expect(await checkSums(handoutDir)).toEqual({ missing: [], extra: [], mismatched: [] });
  });

  it("holds exactly the handout", () => {
    expect(readdirSync(handoutDir).sort()).toEqual([...handoutFiles(version), "SHA256SUMS"].sort());
  });

  it("carries the guide with this build's version filled in", () => {
    const guide = readFileSync(join(handoutDir, "beta-testing.md"), "utf8");
    expect(guide).toContain(version);
    expect(guide).not.toContain("{{version}}");
  });

  it("leaves the five files of the build in release/", () => {
    const names = readdirSync(releaseDir);
    for (const n of [artifact.mac, artifact.appImage, artifact.tarGz, artifact.portable, artifact.winZip]) expect(names, n).toContain(n);
  });
});
