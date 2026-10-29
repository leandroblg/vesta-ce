/**
 * 017 FR-013, FR-014 (research §4): the third-party notices the Third-Party Licenses window shows (PRD Q213), built
 * from `npm ls --omit=dev --all --json --long`. A package without a license, or with one the allow-list does not
 * satisfy, stops the build.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The spec's allow-list (FR-014): AGPL-3.0-compatible licenses. */
export const ALLOWED_LICENSES = [
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Apache-2.0",
  "MPL-2.0",
  "OFL-1.1",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Python-2.0",
  "Zlib",
  "LGPL-2.1-or-later",
  "LGPL-3.0-or-later",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
] as const;

const allowed = new Set<string>(ALLOWED_LICENSES);

/** One node of `npm ls --json --long`; a peer dependency without an installed copy has no version or path. */
export interface NpmLsNode {
  version?: string;
  path?: string;
  license?: unknown;
  dependencies?: Record<string, NpmLsNode>;
}

export interface Pkg {
  name: string;
  version: string;
  license: string | null;
  dir: string;
}

export interface ElectronEntry {
  name: string;
  version: string;
  license: string;
  text: string;
}

/** True when the SPDX expression can be met with allowed licenses only (`OR`: any side, `AND`: both). */
export function satisfies(expression: string): boolean {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  function primary(): boolean {
    const t = tokens[pos++];
    if (t === undefined) throw new Error("unexpected end");
    if (t === "(") {
      const v = or();
      if (tokens[pos++] !== ")") throw new Error("missing )");
      return v;
    }
    // "X WITH exception" keeps X's verdict.
    if (peek() === "WITH") pos += 2;
    return allowed.has(t);
  }
  function and(): boolean {
    let v = primary();
    while (peek() === "AND") {
      pos++;
      v = primary() && v;
    }
    return v;
  }
  function or(): boolean {
    let v = and();
    while (peek() === "OR") {
      pos++;
      v = and() || v;
    }
    return v;
  }
  try {
    if (tokens.length === 0) return false;
    const v = or();
    return pos === tokens.length && v;
  } catch {
    return false;
  }
}

/** The license field as an SPDX expression; the old `{ type }` and array forms are read too. */
export function licenseOf(field: unknown): string | null {
  if (typeof field === "string") return field.trim() === "" ? null : field.trim();
  const typeOf = (v: unknown) => (typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string" ? (v as { type: string }).type : null);
  if (Array.isArray(field)) {
    const types = field.map(typeOf).filter((t): t is string => t !== null);
    if (types.length === 0) return null;
    return types.length === 1 ? (types[0] ?? null) : `(${types.join(" OR ")})`;
  }
  return typeOf(field);
}

/** Every installed package of the tree once, by name and version, sorted by name. */
export function collectPackages(ls: { dependencies?: Record<string, NpmLsNode> }): Pkg[] {
  const found = new Map<string, Pkg>();
  // npm prints a repeated package as a "deduped" stub without its dependencies, so a key is walked again until one of
  // its occurrences has listed them.
  const walked = new Set<string>();
  const walk = (deps: Record<string, NpmLsNode> | undefined) => {
    for (const [name, node] of Object.entries(deps ?? {})) {
      if (node.version === undefined || node.path === undefined) continue;
      const key = `${name}@${node.version}`;
      if (!found.has(key)) found.set(key, { name, version: node.version, license: licenseOf(node.license), dir: node.path });
      if (node.dependencies !== undefined && !walked.has(key)) {
        walked.add(key);
        walk(node.dependencies);
      }
    }
  };
  walk(ls.dependencies);
  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
}

const TEXT_FILE = /^(licen[cs]e|copying|notice)/i;

/** The package's license, notice and copying files, joined; null when it ships none. */
export function licenseText(dir: string): string | null {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && TEXT_FILE.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return null;
  }
  const texts = names.map((n) => readFileSync(join(dir, n), "utf8").trim()).filter((t) => t !== "");
  return texts.length === 0 ? null : texts.join("\n\n");
}

const RULE = "=".repeat(72);

/** THIRD_PARTY_NOTICES.txt; throws naming the first package whose license is missing or not allowed. */
export function buildNotices({ appVersion, packages, electron }: { appVersion: string; packages: readonly Pkg[]; electron: ElectronEntry }): string {
  for (const p of packages) {
    if (p.license === null) throw new Error(`${p.name}@${p.version} has no license`);
    if (!satisfies(p.license)) throw new Error(`${p.name}@${p.version} has a license that is not allowed: ${p.license}`);
  }
  const entries = [
    ...packages.map((p) => ({ name: p.name, version: p.version, license: p.license ?? "", text: licenseText(p.dir) })),
    { name: electron.name, version: electron.version, license: electron.license, text: electron.text },
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const head = [
    `Third-party notices for Vesta ${appVersion}`,
    "",
    `Vesta is free software under the GNU Affero General Public License, version 3. It bundles the ${String(entries.length)} packages below, each under its own license.`,
  ].join("\n");
  const body = entries.map((e) => [RULE, `${e.name} ${e.version}`, `License: ${e.license}`, "", e.text ?? "No license text is shipped with this package."].join("\n"));
  const tail = [
    RULE,
    "Chromium's own notices ship with the app as LICENSES.chromium.html: beside the program on Linux and Windows, in Vesta.app/Contents/Resources on macOS.",
  ].join("\n");
  return `${[head, ...body, tail].join("\n\n")}\n`;
}
