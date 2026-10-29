/**
 * 017 FR-013, FR-014 (research §4): writes THIRD_PARTY_NOTICES.txt at the repository root from the production
 * dependency tree, for LicenseView's glob to bundle. Run by `package:*`, which deletes the file afterwards; it exits 1
 * naming a package whose license is missing or not allowed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildNotices, collectPackages, licenseText } from "./lib/notices.ts";

export const NOTICES_FILE = "THIRD_PARTY_NOTICES.txt";

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Builds the notices for the project at `root` and writes them; returns the file's path and the entry count. */
export function writeNotices(root: string): { path: string; entries: number } {
  const ls = JSON.parse(execFileSync("npm", ["ls", "--omit=dev", "--all", "--json", "--long"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })) as Parameters<
    typeof collectPackages
  >[0];
  const packages = collectPackages(ls);
  const electronDir = join(root, "node_modules", "electron");
  const electronPkg = readJson(join(electronDir, "package.json")) as { version: string; license: string };
  const appVersion = (readJson(join(root, "package.json")) as { version: string }).version;
  const text = buildNotices({
    appVersion,
    packages,
    electron: { name: "electron", version: electronPkg.version, license: electronPkg.license, text: licenseText(electronDir) ?? "" },
  });
  const path = join(root, NOTICES_FILE);
  writeFileSync(path, text);
  return { path, entries: packages.length + 1 };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const { path, entries } = writeNotices(resolve(import.meta.dirname, ".."));
    process.stdout.write(`Wrote ${path} (${String(entries)} entries).\n`);
  } catch (err) {
    process.stderr.write(`Third-party notices: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
