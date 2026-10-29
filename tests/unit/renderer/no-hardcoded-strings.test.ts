/**
 * Constitution V, 007 CHK004: no user-visible text in the renderer's JSX outside the locale files. Fails on
 * a JSX text node with letters, or a string literal in aria-label, title, placeholder or alt.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../src/renderer");
const NAME_ATTRS = new Set(["aria-label", "title", "placeholder", "alt"]);
/** Not words: symbols and glyphs drawn for decoration. */
const ALLOWED = /^[\s\p{P}\p{S}\d×·•…]*$/u;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

function findings(file: string, text = readFileSync(file, "utf8")): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const where = (node: ts.Node) => `${relative(ROOT, file)}:${String(source.getLineAndCharacterOfPosition(node.getStart()).line + 1)}`;
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText().trim();
      if (text !== "" && /\p{L}/u.test(text) && !ALLOWED.test(text)) out.push(`${where(node)} text "${text}"`);
    }
    if (ts.isJsxAttribute(node) && NAME_ATTRS.has(node.name.getText())) {
      const init = node.initializer;
      const literal =
        init !== undefined &&
        (ts.isStringLiteral(init) ||
          (ts.isJsxExpression(init) && init.expression !== undefined && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))));
      if (literal) {
        const value = ts.isStringLiteral(init) ? init.text : init.expression !== undefined ? (init.expression as ts.StringLiteral).text : "";
        if (/\p{L}/u.test(value)) out.push(`${where(node)} ${node.name.getText()}="${value}"`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe("no hard-coded strings in the renderer (constitution V)", () => {
  it("catches text, names and placeholders written in the JSX", () => {
    const sample = 'const A = () => <button aria-label="Close" title={"Hello"}><b>Save</b> {t("ok")} … ×<input placeholder="Type" /></button>;';
    expect(findings(join(ROOT, "sample.tsx"), sample).map((f) => f.split(" ").slice(1).join(" "))).toEqual([
      'aria-label="Close"',
      'title="Hello"',
      'text "Save"',
      'placeholder="Type"',
    ]);
  });

  it("every visible text and name comes from the locale files", () => {
    expect(tsxFiles(ROOT).flatMap((f) => findings(f))).toEqual([]);
  });
});
