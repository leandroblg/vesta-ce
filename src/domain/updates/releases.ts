/**
 * Reading GitHub's release list (009 FR-023, FR-024b, FR-024c, research §9). Pure: drafts, pre-releases, `-beta.N`
 * tags (017 PRD Q260) and unreadable versions are skipped, the highest valid release wins when it is strictly newer,
 * every address is checked against the Vesta repository, and the file for this system is picked from the file names
 * alone.
 */
import { compareVersions, formatVersion, parseVersion } from "./version";

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

export interface FoundRelease {
  version: string;
  notes: string;
  releaseUrl: string;
  fileUrl: string | null;
}

export type CheckOutcome =
  | { kind: "available"; release: FoundRelease }
  | { kind: "upToDate" }
  | { kind: "failed"; reason: "offline" | "timeout" | "status" | "rateLimited" | "unreadable" | "redirect" | "blocked" };

export type UpdateSystem = "macOS" | "Linux" | "Windows";

export interface ReadContext {
  running: string;
  /** `process.platform`: "darwin", "linux" or "win32". */
  platform: string;
  /** `process.arch`: "arm64" or "x64". */
  arch: string;
  repo: RepoRef;
}

export function systemOf(platform: string): UpdateSystem {
  return platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : "Linux";
}

/** https, host exactly github.com, no user-info or port, no `..`, the repository's release path (FR-024b). */
export function checkReleaseUrl(url: string, repo: RepoRef, kind: "page" | "file"): boolean {
  if (/%2e|\\|\.\./i.test(url)) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.hostname !== "github.com" || u.username !== "" || u.password !== "" || u.port !== "") return false;
  let path: string;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    return false;
  }
  if (path.split("/").some((seg) => seg === "..")) return false;
  const base = `/${repo.owner}/${repo.repo}/releases/`.toLowerCase();
  const prefix = kind === "file" ? `${base}download/` : base;
  return path.toLowerCase().startsWith(prefix);
}

/** 009 file names; 017 (FR-003): the version may carry a `-beta.N` tag. */
export const FILE = /^Vesta-(\d+\.\d+\.\d+(?:-beta\.\d+)?)-(mac|linux|win)-(arm64|x64|x86_64|universal)(-portable)?\.(zip|AppImage|exe)$/;
const OS: Readonly<Record<string, { os: string; ext: string; portable: boolean }>> = {
  darwin: { os: "mac", ext: "zip", portable: false },
  linux: { os: "linux", ext: "AppImage", portable: false },
  win32: { os: "win", ext: "exe", portable: true },
};

/** The one file for this system and processor, or null when none or several match (FR-024c). */
export function pickFile(assets: readonly GitHubAsset[], version: string, platform: string, arch: string, repo: RepoRef): string | null {
  const want = OS[platform];
  if (want === undefined) return null;
  const matches = assets.filter((a) => {
    const m = FILE.exec(a.name);
    if (m === null || m[1] !== version || m[2] !== want.os || m[5] !== want.ext || (m[4] !== undefined) !== want.portable) return false;
    const fileArch = m[3] === "x86_64" ? "x64" : m[3];
    const archOk = fileArch === arch || (want.os === "mac" && fileArch === "universal");
    return archOk && checkReleaseUrl(a.browser_download_url, repo, "file");
  });
  return matches.length === 1 ? (matches[0]?.browser_download_url ?? null) : null;
}

interface RawRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  body: string | null;
  assets: GitHubAsset[];
}

function isRelease(v: unknown): v is RawRelease {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["tag_name"] === "string" &&
    typeof o["draft"] === "boolean" &&
    typeof o["prerelease"] === "boolean" &&
    typeof o["html_url"] === "string" &&
    (o["body"] === null || o["body"] === undefined || typeof o["body"] === "string") &&
    Array.isArray(o["assets"]) &&
    o["assets"].every(
      (a: unknown) =>
        typeof a === "object" && a !== null && typeof (a as Record<string, unknown>)["name"] === "string" && typeof (a as Record<string, unknown>)["browser_download_url"] === "string",
    )
  );
}

export function readReleases(json: unknown, ctx: ReadContext): { outcome: CheckOutcome; ignored: string[] } {
  if (!Array.isArray(json)) return { outcome: { kind: "failed", reason: "unreadable" }, ignored: [] };
  const running = parseVersion(ctx.running);
  const ignored: string[] = [];
  let best: { release: RawRelease; version: NonNullable<ReturnType<typeof parseVersion>> } | null = null;
  json.forEach((item: unknown, i) => {
    if (!isRelease(item)) {
      ignored.push(`release ${String(i)}: malformed`);
      return;
    }
    if (item.draft || item.prerelease) return;
    const version = parseVersion(item.tag_name);
    if (version === null) {
      ignored.push(`release ${String(i)}: unreadable version`);
      return;
    }
    // 017 PRD Q260: a beta is never offered, even when its release is not flagged as a pre-release.
    if (version.beta !== null) return;
    if (best === null || compareVersions(version, best.version) > 0) best = { release: item, version };
  });
  const found = best as { release: RawRelease; version: NonNullable<ReturnType<typeof parseVersion>> } | null;
  if (found === null || running === null || compareVersions(found.version, running) <= 0) return { outcome: { kind: "upToDate" }, ignored };
  const version = formatVersion(found.version);
  const page = `https://github.com/${ctx.repo.owner}/${ctx.repo.repo}/releases/tag/${found.release.tag_name}`;
  const releaseUrl = checkReleaseUrl(found.release.html_url, ctx.repo, "page") ? found.release.html_url : page;
  return {
    outcome: {
      kind: "available",
      release: { version, notes: found.release.body ?? "", releaseUrl, fileUrl: pickFile(found.release.assets, version, ctx.platform, ctx.arch, ctx.repo) },
    },
    ignored,
  };
}
