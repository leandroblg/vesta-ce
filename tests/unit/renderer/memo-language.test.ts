/** 007 research §4: a memo() component must read `language`, or a language switch would leave its old text. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../src/renderer");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/** Each `memo(function Name(` with its body, up to the closing `});` at the start of a line. */
function memoBodies(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /memo\(function (\w+)\(/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    const end = source.indexOf("\n});", m.index);
    out.push({ name: m[1] ?? "?", body: source.slice(m.index, end === -1 ? undefined : end) });
  }
  return out;
}

describe("memo components follow the language (007 FR-017)", () => {
  const found = tsxFiles(ROOT).flatMap((file) => memoBodies(readFileSync(file, "utf8")).map((b) => ({ file, ...b })));

  it("finds the known memo components", () => {
    expect(found.map((f) => f.name).sort()).toEqual(expect.arrayContaining(["Markdown", "Row", "TaskCard", "TaskNode"]));
  });

  it.each(found.map((f) => [f.name, f.body] as const))("%s selects language from the store", (_name, body) => {
    expect(body).toMatch(/useVesta\(\(s\) => s\.language\)/);
  });
});
