/** 009 helpers: the fixture release source (contracts/ipc.md "Test transport" and "Test hooks"). */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication } from "@playwright/test";

/** What the fixture transport answers (contracts/ipc.md `setReleases(source)`). */
export type ReleaseSource =
  | { status: number; body: unknown; headers?: Record<string, string>; redirect?: string; delayMs?: number }
  | { fail: "offline" | "timeout"; delayMs?: number };

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  body: string | null;
  assets: GitHubAsset[];
}

export const REPO = { owner: "OWNER", repo: "vesta" };

/** The file names research §9 defines, for every system Vesta ships. */
export function assetNames(version: string): string[] {
  return [
    `Vesta-${version}-mac-arm64.zip`,
    `Vesta-${version}-mac-x64.zip`,
    `Vesta-${version}-linux-x64.AppImage`,
    `Vesta-${version}-linux-x64.tar.gz`,
    `Vesta-${version}-linux-arm64.AppImage`,
    `Vesta-${version}-win-x64-portable.exe`,
    `Vesta-${version}-win-x64.zip`,
  ];
}

export function release(
  version: string,
  options: { draft?: boolean; prerelease?: boolean; notes?: string | null; assets?: string[] } = {},
): GitHubRelease {
  const tag = `v${version}`;
  const base = `https://github.com/${REPO.owner}/${REPO.repo}/releases`;
  return {
    tag_name: tag,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? false,
    html_url: `${base}/tag/${tag}`,
    body: options.notes === undefined ? `## What's new in ${version}\n\n- Faster start` : options.notes,
    assets: (options.assets ?? assetNames(version)).map((name) => ({ name, browser_download_url: `${base}/download/${tag}/${name}` })),
  };
}

/** A 200 answer with these releases. */
export const answer = (releases: GitHubRelease[], delayMs?: number): ReleaseSource =>
  delayMs === undefined ? { status: 200, body: releases } : { status: 200, body: releases, delayMs };

/** Writes a source to a temp file, for VESTA_TEST_RELEASES at launch. */
export function releasesFile(source: ReleaseSource): string {
  const path = join(mkdtempSync(join(tmpdir(), "vesta-releases-")), "releases.json");
  writeFileSync(path, JSON.stringify(source));
  return path;
}

export async function useReleases(app: ElectronApplication, source: ReleaseSource): Promise<void> {
  await app.evaluate((_e, s) => {
    (globalThis as unknown as { __vestaTest: { setReleases(x: unknown): void } }).__vestaTest.setReleases(s);
  }, source);
}

export async function updateRequests(app: ElectronApplication): Promise<{ url: string; headers: Record<string, string> }[]> {
  return app.evaluate(() =>
    (globalThis as unknown as { __vestaTest: { updateRequests(): { url: string; headers: Record<string, string> }[] } }).__vestaTest.updateRequests(),
  );
}

/** Runs the update scheduler's tick now (after the clock hook moved time). */
export async function tickUpdates(app: ElectronApplication): Promise<void> {
  await app.evaluate(async () => {
    await (globalThis as unknown as { __vestaTest: { tickUpdates(): Promise<void> } }).__vestaTest.tickUpdates();
  });
}

/** The real network transport against a blocked address; true when the allow-list cancelled it. */
export async function probeBlockedFetch(app: ElectronApplication, url: string): Promise<boolean> {
  return app.evaluate(
    async (_e, u) => (globalThis as unknown as { __vestaTest: { probeBlockedFetch(x: string): Promise<boolean> } }).__vestaTest.probeBlockedFetch(u),
    url,
  );
}
