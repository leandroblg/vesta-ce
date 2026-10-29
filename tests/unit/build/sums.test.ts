import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSums, formatSums, sha256File } from "../../../scripts/lib/sums.ts";

const HELLO_SHA = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "vesta-sums-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe("SHA256SUMS (017 FR-007, FR-020, data-model Handout set)", () => {
  it("hashes a file", async () => {
    const dir = folder({ "a.txt": "hello" });
    expect(await sha256File(join(dir, "a.txt"))).toBe(HELLO_SHA);
  });

  it("writes `<hash>  <name>` lines sorted by name", () => {
    const text = formatSums([
      { name: "b.zip", hash: "B".repeat(64) },
      { name: "a.AppImage", hash: "a".repeat(64) },
    ]);
    expect(text).toBe(`${"a".repeat(64)}  a.AppImage\n${"b".repeat(64)}  b.zip\n`);
  });

  it("refuses a hash that is not 64 hex digits", () => {
    expect(() => formatSums([{ name: "x", hash: "abc" }])).toThrow(/x/);
  });

  it("finds nothing wrong in a matching folder", async () => {
    const dir = folder({ "a.txt": "hello", "b.txt": "world" });
    writeFileSync(join(dir, "SHA256SUMS"), formatSums([{ name: "a.txt", hash: HELLO_SHA }, { name: "b.txt", hash: await sha256File(join(dir, "b.txt")) }]));
    expect(await checkSums(dir)).toEqual({ missing: [], extra: [], mismatched: [] });
  });

  it("reports a file without a line, a line without a file and a wrong hash", async () => {
    const dir = folder({ "a.txt": "hello", "b.txt": "changed", "c.txt": "unlisted" });
    writeFileSync(
      join(dir, "SHA256SUMS"),
      formatSums([
        { name: "a.txt", hash: HELLO_SHA },
        { name: "b.txt", hash: "0".repeat(64) },
        { name: "gone.txt", hash: "1".repeat(64) },
      ]),
    );
    expect(await checkSums(dir)).toEqual({ missing: ["gone.txt"], extra: ["c.txt"], mismatched: ["b.txt"] });
  });
});
