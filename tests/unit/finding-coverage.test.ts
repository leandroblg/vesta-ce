// 010 FR-030: every finding in scope has at least one test whose title carries its id, so `grep` finds the proof.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const IN_SCOPE = ["M1", "M2", "M3", "M4", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "L12", "L13", "L14", "L15", "L16", "I1", "I2", "I4"];

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return testFiles(path);
    return /\.(test|spec)\.tsx?$/.test(name) ? [path] : [];
  });
}

function titles(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = /\b(?:it|test|describe)\b(?:\.\w+(?:\([^)]*\))?)*\(\s*(["'`])(.*?)\1/.exec(line);
    if (m?.[2] !== undefined) out.push(m[2]);
  }
  return out;
}

describe("finding coverage (010 FR-030)", () => {
  const all = testFiles(resolve(import.meta.dirname, "..")).flatMap((f) => titles(readFileSync(f, "utf8")));

  it.each(IN_SCOPE)("%s appears in at least one test title", (id) => {
    const word = new RegExp(`(?:^|[^A-Za-z0-9])${id}(?![0-9])`);
    expect(all.filter((t) => word.test(t)).length, id).toBeGreaterThan(0);
  });
});
