/**
 * 017 research §8: the beta build's steps, with the command runner injected so the order, the refusals and the
 * failure path are unit-tested. `scripts/package-beta.ts` calls `runPackage` with the real runner.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isBeta } from "../../src/domain/updates/version.ts";
import { formatSums, hashFiles, SUMS_FILE } from "./sums.ts";

export type Mode = "--all" | "--mac" | "--linux" | "--win";

export interface Runner {
  /** Runs a command in the project folder; resolves with its output on exit 0, rejects otherwise. */
  exec(cmd: string, args: string[], options?: { env?: NodeJS.ProcessEnv; capture?: boolean }): Promise<string>;
  /** Writes every icon file; false when macOS falls back to the .icns (research §3). */
  icons(root: string): boolean;
  notices(root: string): void;
}

export const NOTICES_FILE = "THIRD_PARTY_NOTICES.txt";
export const GUIDE = "beta-testing.md";

/** The tester guide is not kept in this repository: `--all` takes its path with `--guide <path>` (FR-012). */
export function guideSource(guide: string | undefined): string {
  if (guide === undefined || guide === "") throw new Error("the handout needs the tester guide: pass --guide <path to beta-testing.md>");
  if (!existsSync(guide)) throw new Error(`tester guide not found at ${guide}`);
  return guide;
}

export function checkBetaVersion(version: string): void {
  if (!isBeta(version)) throw new Error(`version must carry a -beta.N tag (package.json has ${version})`);
}

/** FR-002a, FR-002b: no release token and no signing material reach electron-builder; it never looks for an identity. */
export function buildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === "GH_TOKEN" || k === "GITHUB_TOKEN" || k.startsWith("CSC_") || k.startsWith("WIN_CSC_") || k.startsWith("APPLE_")) continue;
    out[k] = v;
  }
  out["CSC_IDENTITY_AUTO_DISCOVERY"] = "false";
  return out;
}

export const isCleanTree = (porcelain: string): boolean => porcelain.trim() === "";

export const fillVersion = (text: string, version: string): string => text.replaceAll("{{version}}", version);
/** The guide names the build exactly: its version and the commit it was built from (PRD Q292). */
export const fillGuide = (text: string, version: string, commit: string): string => fillVersion(text, version).replaceAll("{{commit}}", commit);

export const artifactNames = (v: string) => ({
  mac: `Vesta-${v}-mac-arm64.zip`,
  linux: [`Vesta-${v}-linux-x86_64.AppImage`, `Vesta-${v}-linux-x86_64.tar.gz`],
  win: [`Vesta-${v}-win-x64-portable.exe`, `Vesta-${v}-win-x64.zip`],
});

/**
 * The handout folder's files besides SHA256SUMS (FR-007): never the macOS build, and no source archive since
 * PRD Q292: the guide names the public repository and the commit the build was made from.
 */
export function handoutFiles(version: string): string[] {
  const a = artifactNames(version);
  return [...a.linux, ...a.win, "LICENSE", "TRADEMARKS.md", GUIDE];
}

const SYSTEMS = { "--mac": "macOS", "--linux": "Linux", "--win": "Windows" } as const;

/** One electron-builder run per system, so a failure names its system (FR-002); never publishing (FR-002a). */
export function builderRuns(mode: Mode): { system: string; args: string[] }[] {
  const flags = mode === "--all" ? (["--mac", "--linux", "--win"] as const) : [mode];
  return flags.map((flag) => ({ system: SYSTEMS[flag], args: [flag, "--publish", "never"] }));
}

export async function runPackage({ root, mode, env, guide }: { root: string; mode: Mode; env: NodeJS.ProcessEnv; guide?: string }, runner: Runner): Promise<void> {
  const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
  checkBetaVersion(version);
  const guidePath = mode === "--all" ? guideSource(guide) : undefined;
  if (mode === "--all") {
    const porcelain = await runner.exec("git", ["status", "--porcelain", "--untracked-files=no"], { capture: true });
    if (!isCleanTree(porcelain)) throw new Error("tracked files have uncommitted changes: commit them first, so the commit the guide names is the one that was built");
  }
  const release = join(root, "release");
  rmSync(release, { recursive: true, force: true });
  try {
    const iconComposer = runner.icons(root);
    runner.notices(root);
    await runner.exec("npx", ["electron-vite", "build"]);
    for (const run of builderRuns(mode)) {
      try {
        const icon = !iconComposer && run.system === "macOS" ? ["-c.mac.icon=build/icon.icns"] : [];
        await runner.exec("npx", ["electron-builder", ...run.args, "--config", "electron-builder.yml", ...icon], { env: buildEnv(env) });
      } catch {
        throw new Error(`Build failed for ${run.system}: see the electron-builder output above.`);
      }
    }
    if (guidePath !== undefined) await writeHandout(root, version, guidePath, runner);
  } finally {
    rmSync(join(root, NOTICES_FILE), { force: true });
  }
}

/**
 * release/handout/: the four Linux and Windows files, LICENSE, TRADEMARKS.md (018 FR-025), the tester guide with its
 * version and the built commit filled in (it names the repository where the source is, PRD Q292), then SHA256SUMS last.
 */
async function writeHandout(root: string, version: string, guide: string, runner: Runner): Promise<void> {
  const release = join(root, "release");
  const handout = join(release, "handout");
  mkdirSync(handout);
  const a = artifactNames(version);
  for (const name of [...a.linux, ...a.win]) copyFileSync(join(release, name), join(handout, name));
  const commit = (await runner.exec("git", ["rev-parse", "HEAD"], { capture: true })).trim();
  copyFileSync(join(root, "LICENSE"), join(handout, "LICENSE"));
  copyFileSync(join(root, "TRADEMARKS.md"), join(handout, "TRADEMARKS.md"));
  writeFileSync(join(handout, GUIDE), fillGuide(readFileSync(guide, "utf8"), version, commit));
  writeFileSync(join(handout, SUMS_FILE), formatSums(await hashFiles(handout, handoutFiles(version))));
}
