import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_LICENSES, buildNotices, collectPackages, satisfies, type NpmLsNode } from "../../../scripts/lib/notices.ts";

/** A fake node_modules tree and the `npm ls --omit=dev --all --json --long` answer for it. */
function tree(pkgs: { name: string; version: string; license?: unknown; files?: Record<string, string>; deps?: string[] }[]) {
  const root = mkdtempSync(join(tmpdir(), "vesta-notices-"));
  const nodes = new Map<string, NpmLsNode>();
  for (const p of pkgs) {
    const dir = join(root, "node_modules", p.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: p.name, version: p.version, license: p.license }));
    for (const [f, text] of Object.entries(p.files ?? {})) writeFileSync(join(dir, f), text);
    nodes.set(p.name, { version: p.version, path: dir, license: p.license });
  }
  for (const p of pkgs) {
    const node = nodes.get(p.name);
    if (node !== undefined && p.deps !== undefined) node.dependencies = Object.fromEntries(p.deps.map((d) => [d, nodes.get(d) ?? {}]));
  }
  const top = pkgs.filter((p) => !pkgs.some((q) => q.deps?.includes(p.name)));
  return { root, ls: { dependencies: Object.fromEntries(top.map((p) => [p.name, nodes.get(p.name) ?? {}])) } };
}

const electron = { name: "electron", version: "44.8.0", license: "MIT", text: "Copyright (c) Electron contributors" };

describe("license expressions (017 FR-014)", () => {
  it("is exactly the spec's allow-list", () => {
    expect([...ALLOWED_LICENSES]).toEqual([
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
    ]);
  });

  it("reads OR, AND and parentheses", () => {
    expect(satisfies("MIT")).toBe(true);
    expect(satisfies("(MPL-2.0 OR Apache-2.0)")).toBe(true);
    expect(satisfies("GPL-2.0-only OR MIT")).toBe(true);
    expect(satisfies("MIT AND GPL-3.0-only")).toBe(false);
    expect(satisfies("(MIT OR GPL-3.0-only) AND ISC")).toBe(true);
    expect(satisfies("GPL-2.0-only")).toBe(false);
    expect(satisfies("SEE LICENSE IN LICENSE.txt")).toBe(false);
    expect(satisfies("")).toBe(false);
  });
});

describe("third-party notices (017 FR-013, FR-014, research §4)", () => {
  it("deduplicates, sorts by name, joins the license files and adds Electron and Chromium's line", () => {
    const { ls } = tree([
      { name: "zeta", version: "1.0.0", license: "MIT", files: { LICENSE: "zeta license", "NOTICE.md": "zeta notice" }, deps: ["alpha"] },
      { name: "alpha", version: "2.0.0", license: "(MPL-2.0 OR Apache-2.0)", files: { "LICENCE.txt": "alpha licence" } },
      { name: "bare", version: "0.1.0", license: "ISC" },
    ]);
    const packages = collectPackages(ls);
    expect(packages.map((p) => `${p.name}@${p.version}`)).toEqual(["alpha@2.0.0", "bare@0.1.0", "zeta@1.0.0"]);
    const text = buildNotices({ appVersion: "0.1.0-beta.1", packages, electron });
    expect(text).toMatch(/^Third-party notices for Vesta 0\.1\.0-beta\.1/);
    const order = ["alpha 2.0.0", "bare 0.1.0", "electron 44.8.0", "zeta 1.0.0"].map((h) => text.indexOf(h));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("License: (MPL-2.0 OR Apache-2.0)");
    expect(text).toContain("alpha licence");
    expect(text).toContain("zeta license");
    expect(text).toContain("zeta notice");
    expect(text).toContain("No license text is shipped with this package.");
    expect(text).toContain("Copyright (c) Electron contributors");
    expect(text.trimEnd().endsWith("Chromium's own notices ship with the app as LICENSES.chromium.html: beside the program on Linux and Windows, in Vesta.app/Contents/Resources on macOS.")).toBe(true);
  });

  it("lists a package reached twice once", () => {
    const { ls } = tree([
      { name: "a", version: "1.0.0", license: "MIT", deps: ["shared"] },
      { name: "b", version: "1.0.0", license: "MIT", deps: ["shared"] },
      { name: "shared", version: "3.0.0", license: "MIT" },
    ]);
    expect(collectPackages(ls).filter((p) => p.name === "shared")).toHaveLength(1);
  });

  it("walks the dependencies of a package npm first prints as a deduped stub", () => {
    const { root } = tree([{ name: "leaf", version: "1.0.0", license: "MIT" }]);
    const dir = (n: string) => join(root, "node_modules", n);
    const ls = {
      dependencies: {
        a: { version: "1.0.0", path: dir("leaf"), license: "MIT", dependencies: { shared: { version: "2.0.0", path: dir("leaf"), license: "MIT" } } },
        b: {
          version: "1.0.0",
          path: dir("leaf"),
          license: "MIT",
          dependencies: { shared: { version: "2.0.0", path: dir("leaf"), license: "MIT", dependencies: { deep: { version: "3.0.0", path: dir("leaf"), license: "MIT" } } } },
        },
      },
    };
    expect(collectPackages(ls).map((p) => p.name)).toEqual(["a", "b", "deep", "shared"]);
  });

  it("skips peer dependencies npm lists without an installed copy", () => {
    const { ls } = tree([{ name: "a", version: "1.0.0", license: "MIT" }]);
    const a = ls.dependencies["a"];
    if (a === undefined) throw new Error("fixture");
    a.dependencies = { immer: {} };
    expect(collectPackages(ls).map((p) => p.name)).toEqual(["a"]);
  });

  it("fails naming a package without a license", () => {
    const { ls } = tree([{ name: "nolicense", version: "1.2.3" }]);
    expect(() => buildNotices({ appVersion: "0.1.0-beta.1", packages: collectPackages(ls), electron })).toThrow("nolicense@1.2.3");
  });

  it("fails naming a package whose license is not allowed", () => {
    const { ls } = tree([{ name: "copyleft", version: "2.0.0", license: "GPL-3.0-only" }]);
    expect(() => buildNotices({ appVersion: "0.1.0-beta.1", packages: collectPackages(ls), electron })).toThrow(/copyleft@2\.0\.0.*GPL-3\.0-only/);
  });

  it("reads the old object and array forms of the license field", () => {
    const { ls } = tree([
      { name: "obj", version: "1.0.0", license: { type: "MIT" } },
      { name: "arr", version: "1.0.0", license: [{ type: "MIT" }, { type: "Apache-2.0" }] },
    ]);
    const text = buildNotices({ appVersion: "0.1.0-beta.1", packages: collectPackages(ls), electron });
    expect(text).toContain("License: (MIT OR Apache-2.0)");
  });
});
