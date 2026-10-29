import { describe, expect, it } from "vitest";
import { compareVersions, formatVersion, isBeta, parseVersion } from "../../../../src/domain/updates/version";

describe("versions (009 FR-023, research §7; 017 FR-003a, FR-004, PRD Q260)", () => {
  it("reads major.minor.patch with an optional v", () => {
    expect(parseVersion("0.1.0")).toEqual({ major: 0, minor: 1, patch: 0, beta: null });
    expect(parseVersion("v0.1.0")).toEqual({ major: 0, minor: 1, patch: 0, beta: null });
    expect(parseVersion("10.20.30")).toEqual({ major: 10, minor: 20, patch: 30, beta: null });
  });

  it("reads a -beta.N tag", () => {
    expect(parseVersion("0.1.0-beta.1")).toEqual({ major: 0, minor: 1, patch: 0, beta: 1 });
    expect(parseVersion("v0.1.0-beta.12")).toEqual({ major: 0, minor: 1, patch: 0, beta: 12 });
    expect(parseVersion("1.2.3-beta.0")).toEqual({ major: 1, minor: 2, patch: 3, beta: 0 });
  });

  it("refuses anything else, other pre-release tags included", () => {
    for (const bad of [
      "0.1",
      "0.1.0-beta",
      "0.1.0-beta.01",
      "0.1.0-rc.1",
      "0.1.0-alpha.1",
      "0.1.0-beta.1-mac",
      "0.1.0-BETA.1",
      "01.0.0",
      "v",
      "",
      "1.2.3.4",
      "V1.2.3",
      " 1.2.3",
      "1.2.x",
      "-1.2.3",
    ]) {
      expect(parseVersion(bad), bad).toBeNull();
    }
  });

  it("compares numerically", () => {
    const v = (s: string) => parseVersion(s) ?? { major: -1, minor: -1, patch: -1, beta: null };
    expect(compareVersions(v("0.10.0"), v("0.9.0"))).toBeGreaterThan(0);
    expect(compareVersions(v("1.0.0"), v("0.99.99"))).toBeGreaterThan(0);
    expect(compareVersions(v("0.2.1"), v("0.2.10"))).toBeLessThan(0);
    expect(compareVersions(v("1.2.3"), v("v1.2.3"))).toBe(0);
  });

  it("orders betas before their release and after the release below (Q260)", () => {
    const order = ["0.0.9", "0.1.0-beta.1", "0.1.0-beta.2", "0.1.0-beta.10", "0.1.0", "0.1.1-beta.1", "0.1.1"];
    const parsed = order.map((s) => parseVersion(s));
    for (let i = 0; i + 1 < parsed.length; i++) {
      const a = parsed[i];
      const b = parsed[i + 1];
      if (a == null || b == null) throw new Error(`unparsed ${order[i] ?? ""}`);
      expect(compareVersions(a, b), `${order[i] ?? ""} < ${order[i + 1] ?? ""}`).toBeLessThan(0);
      expect(compareVersions(b, a)).toBeGreaterThan(0);
    }
    const beta = parseVersion("0.1.0-beta.3");
    if (beta === null) throw new Error("unparsed");
    expect(compareVersions(beta, beta)).toBe(0);
  });

  it("writes the tag back", () => {
    for (const s of ["0.1.0", "0.1.0-beta.1", "2.10.3-beta.14"]) {
      const v = parseVersion(s);
      if (v === null) throw new Error(s);
      expect(formatVersion(v)).toBe(s);
    }
  });

  it("tells a beta from a release", () => {
    expect(isBeta("0.1.0-beta.3")).toBe(true);
    expect(isBeta("0.1.0")).toBe(false);
    expect(isBeta("0.1.0-rc.1")).toBe(false);
    expect(isBeta("junk")).toBe(false);
  });
});
