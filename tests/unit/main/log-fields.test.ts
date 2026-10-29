// 009 FR-003, research §4, checklist CHK021–CHK025: every field a log call writes is on the allowed list.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { LOG_FIELDS, LOG_FIELDS_ONLY_IN, LOG_SPREADS } from "../../../src/main/log-fields";

const ROOT = join(import.meta.dirname, "../../..");
const LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

/** `log.x(...)`, `deps.log.x(...)`, `this.opts.log.x(...)`: a level method on something named log. */
function isLogCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || !LEVELS.has(callee.name.text)) return false;
  const target = callee.expression;
  if (ts.isIdentifier(target)) return target.text === "log";
  return ts.isPropertyAccessExpression(target) && target.name.text === "log";
}

interface Finding {
  file: string;
  line: number;
  what: string;
}

function audit(): Finding[] {
  const findings: Finding[] = [];
  for (const path of sources(join(ROOT, "src/main"))) {
    const file = relative(ROOT, path);
    if (file === "src/main/log.ts") continue;
    const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && isLogCall(node)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const fields = node.arguments[1];
        if (fields !== undefined) {
          if (ts.isObjectLiteralExpression(fields)) {
            for (const p of fields.properties) {
              if (ts.isSpreadAssignment(p)) {
                const src = p.expression.getText(sf);
                if (!LOG_SPREADS.includes(src)) findings.push({ file, line, what: `spread ...${src}` });
                continue;
              }
              const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : p.getText(sf);
              if (!LOG_FIELDS.includes(name)) findings.push({ file, line, what: `field ${name}` });
              const only = LOG_FIELDS_ONLY_IN[name];
              if (only !== undefined && !only.includes(file)) findings.push({ file, line, what: `field ${name} outside ${only.join(", ")}` });
            }
          } else if (!(ts.isIdentifier(fields) && fields.text === "fields")) {
            // Only a plain forwarding wrapper may pass a fields object through (it is audited at its callers).
            findings.push({ file, line, what: `non-literal fields ${fields.getText(sf)}` });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

describe("log fields (009 FR-003)", () => {
  it("every logged field name is on the allowed list", () => {
    expect(audit()).toEqual([]);
  });
});
