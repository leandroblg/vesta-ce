/** 017 FR-007, SC-002: the macOS build is never in the handout (it stays on the building Mac, FR-009). */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handoutDir, missingBuild } from "./release";

const sums = join("handout", "SHA256SUMS");
describe.skipIf(missingBuild(sums) !== null)(missingBuild(sums) ?? "no macOS file in the handout", () => {
  it("lists and holds no macOS file", () => {
    expect(readdirSync(handoutDir).filter((n) => n.includes("-mac-"))).toEqual([]);
    expect(readFileSync(join(handoutDir, "SHA256SUMS"), "utf8")).not.toContain("-mac-");
  });
});
