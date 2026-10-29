import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(import.meta.dirname, "../../../.github/workflows/ci.yml"), "utf8");
const lines = workflow.split("\n");

describe("L7/L8 the CI workflow is pinned, read-only and audited (010 FR-028, FR-029)", () => {
  it("L8 every action is pinned to a full commit with its version in a comment", () => {
    const uses = lines.filter((l) => /^\s*-?\s*uses:/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(/uses:\s*\S+@[0-9a-f]{40}\s*#\s*v\d+\.\d+\.\d+\s*$/);
    }
  });

  it("L8 the workflow declares read-only repository permissions at the top level and no job widens them", () => {
    const jobsAt = lines.findIndex((l) => /^jobs:/.test(l));
    const permissionsAt = lines.findIndex((l) => /^permissions:/.test(l));
    expect(permissionsAt).toBeGreaterThanOrEqual(0);
    expect(permissionsAt).toBeLessThan(jobsAt);
    expect(lines[permissionsAt + 1]).toMatch(/^\s+contents:\s*read\s*$/);
    const jobPermissions = lines.slice(jobsAt).filter((l) => /^\s+permissions:/.test(l));
    for (const line of jobPermissions) {
      const index = lines.indexOf(line);
      expect(lines.slice(index + 1, index + 4).join("\n")).not.toMatch(/:\s*write/);
    }
  });

  it("L7 an audit of the runtime dependencies gates the pipeline after npm ci", () => {
    const ci = lines.findIndex((l) => /run:\s*npm ci\s*$/.test(l));
    const audit = lines.findIndex((l) => /run:\s*npm audit --omit=dev --audit-level=high\s*$/.test(l));
    expect(ci).toBeGreaterThanOrEqual(0);
    expect(audit).toBeGreaterThan(ci);
  });
});
