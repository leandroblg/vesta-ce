/**
 * The app archive of every build holds the compiled app and nothing else: never the sources, the tests, the build
 * scripts, the specs or local files (electron-builder.yml, each platform's `files` list). Run by
 * `npm run test:package` after `npm run package:beta`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFile, listPackage, statFile } from "@electron/asar";
import { describe, expect, it } from "vitest";
import { artifact, missingBuild, releaseDir, repoRoot } from "./release";

/** The only top-level entries an app archive may hold. */
const ALLOWED = ["LICENSE", "TRADEMARKS.md", "node_modules", "out", "package.json"];

/**
 * The name@version pairs the lockfile installs for development only. electron-builder flattens node_modules, so a
 * shipped package is matched by name and version, not by its path in the lockfile.
 */
const devOnly = (() => {
  const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string; dev?: boolean }>;
  };
  const dev = new Set<string>();
  const runtime = new Set<string>();
  for (const [path, entry] of Object.entries(lock.packages)) {
    const at = path.lastIndexOf("node_modules/");
    if (at < 0 || entry.version === undefined) continue;
    const id = `${path.slice(at + "node_modules/".length)}@${entry.version}`;
    (entry.dev === true ? dev : runtime).add(id);
  }
  return new Set([...dev].filter((id) => !runtime.has(id)));
})();

/** Extracts the one app.asar of an archive into a fresh folder and returns its path. */
function asarOf(file: string, kind: "tar" | "zip"): string {
  const out = mkdtempSync(join(tmpdir(), "vesta-asar-"));
  const list =
    kind === "tar"
      ? execFileSync("tar", ["-tzf", file], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8")
      : execFileSync("unzip", ["-Z1", file], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  const names = list.split("\n").filter((n) => n.endsWith("/app.asar"));
  expect(names, `one app.asar in ${file}`).toHaveLength(1);
  const name = names[0] as string;
  if (kind === "tar") execFileSync("tar", ["-xzf", file, "-C", out, name]);
  else execFileSync("unzip", ["-q", file, name, "-d", out]);
  return join(out, name);
}

const builds = [
  { label: "Linux .tar.gz", file: artifact.tarGz, kind: "tar" },
  { label: "Windows .zip", file: artifact.winZip, kind: "zip" },
  { label: "macOS .zip", file: artifact.mac, kind: "zip" },
] as const;

for (const build of builds) {
  describe.skipIf(missingBuild(build.file) !== null)(missingBuild(build.file) ?? `${build.label} app archive`, () => {
    let asar = "";
    const entries = () => {
      asar = asarOf(join(releaseDir, build.file), build.kind);
      return listPackage(asar, { isPack: false }).map((p) => p.replace(/\\/g, "/"));
    };

    it("holds the compiled app, its runtime dependencies, the license, the notice and package.json only", () => {
      const all = entries();
      const top = [...new Set(all.map((p) => p.split("/")[1] ?? ""))].sort();
      expect(top).toEqual(ALLOWED);
      expect(all.filter((p) => !p.startsWith("/node_modules/") && /\.(ts|tsx|map)$/.test(p))).toEqual([]);
      expect(all.filter((p) => /^\/node_modules\/better-sqlite3\/(src|deps|build)\//.test(p))).toEqual([]);
      const shipped = all
        // Unpacked files (the SQLite module) sit beside the archive, outside this extraction.
        .filter((p) => (statFile(asar, p.slice(1)) as { unpacked?: boolean }).unpacked !== true)
        .filter((p) => /^\/node_modules\/(@[^/]+\/)?[^/@]+(\/node_modules\/(@[^/]+\/)?[^/]+)*\/package\.json$/.test(p))
        .map((p) => {
          const name = p.slice(p.lastIndexOf("node_modules/") + "node_modules/".length, -"/package.json".length);
          const manifest = JSON.parse(extractFile(asar, p.slice(1)).toString("utf8")) as { version?: string };
          return `${name}@${manifest.version ?? ""}`;
        });
      expect(shipped.filter((id) => devOnly.has(id))).toEqual([]);
    });
  });
}
