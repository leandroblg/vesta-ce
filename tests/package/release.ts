/** 017 FR-021: where the beta build lives, and the message every packaged check skips with when it is missing. */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const repoRoot = resolve(import.meta.dirname, "../..");
export const releaseDir = join(repoRoot, "release");
export const handoutDir = join(releaseDir, "handout");
export const version = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }).version;

export const SKIP_MESSAGE = "No beta build in release/: run npm run package:beta first.";

/** The skip message when any of these paths (relative to release/) is missing, otherwise null. */
export function missingBuild(...paths: string[]): string | null {
  return paths.every((p) => existsSync(join(releaseDir, p))) ? null : SKIP_MESSAGE;
}

export const artifact = {
  mac: `Vesta-${version}-mac-arm64.zip`,
  appImage: `Vesta-${version}-linux-x86_64.AppImage`,
  tarGz: `Vesta-${version}-linux-x86_64.tar.gz`,
  portable: `Vesta-${version}-win-x64-portable.exe`,
  winZip: `Vesta-${version}-win-x64.zip`,
} as const;
