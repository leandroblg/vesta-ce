import { describe, expect, it } from "vitest";
import { FILE, checkReleaseUrl, pickFile, readReleases, systemOf, type GitHubAsset } from "../../../../src/domain/updates/releases";

const REPO = { owner: "OWNER", repo: "vesta" };
const BASE = "https://github.com/OWNER/vesta/releases";
const NAMES = (v: string) => [
  `Vesta-${v}-mac-arm64.zip`,
  `Vesta-${v}-mac-x64.zip`,
  `Vesta-${v}-linux-x64.AppImage`,
  `Vesta-${v}-linux-x64.tar.gz`,
  `Vesta-${v}-linux-arm64.AppImage`,
  `Vesta-${v}-win-x64-portable.exe`,
  `Vesta-${v}-win-x64.zip`,
];
const assets = (v: string, names = NAMES(v)): GitHubAsset[] => names.map((name) => ({ name, browser_download_url: `${BASE}/download/v${v}/${name}` }));
const rel = (v: string, over: Record<string, unknown> = {}) => ({
  tag_name: `v${v}`,
  draft: false,
  prerelease: false,
  html_url: `${BASE}/tag/v${v}`,
  body: `Notes for ${v}`,
  assets: assets(v),
  ...over,
});
const read = (json: unknown, running = "0.1.0", platform = "darwin", arch = "arm64") => readReleases(json, { running, platform, arch, repo: REPO });

describe("readReleases (009 FR-023, research §9)", () => {
  it("picks the highest valid release when it is strictly newer", () => {
    const r = read([rel("0.2.0"), rel("0.10.0"), rel("0.9.1")]);
    expect(r.outcome).toEqual({
      kind: "available",
      release: { version: "0.10.0", notes: "Notes for 0.10.0", releaseUrl: `${BASE}/tag/v0.10.0`, fileUrl: `${BASE}/download/v0.10.0/Vesta-0.10.0-mac-arm64.zip` },
    });
  });

  it("skips drafts, pre-releases, unreadable tags and malformed releases, and reports them", () => {
    const r = read([
      rel("0.5.0", { draft: true }),
      rel("0.4.0", { prerelease: true }),
      rel("0.3.0", { tag_name: "nightly" }),
      { tag_name: "v0.9.0" },
      "junk",
      rel("0.2.0"),
    ]);
    expect(r.outcome).toMatchObject({ kind: "available", release: { version: "0.2.0" } });
    expect(r.ignored).toEqual(["release 2: unreadable version", "release 3: malformed", "release 4: malformed"]);
  });

  it("is up to date when nothing is newer, the running build newer than every release included", () => {
    expect(read([rel("0.1.0")]).outcome).toEqual({ kind: "upToDate" });
    expect(read([rel("0.1.0")], "0.3.0").outcome).toEqual({ kind: "upToDate" });
    expect(read([]).outcome).toEqual({ kind: "upToDate" });
    expect(read([rel("0.9.0", { draft: true }), rel("0.8.0", { prerelease: true })]).outcome).toEqual({ kind: "upToDate" });
  });

  it("fails as unreadable when the answer is not a list", () => {
    for (const bad of [null, {}, "x", 3]) expect(read(bad).outcome).toEqual({ kind: "failed", reason: "unreadable" });
  });

  it("drops a release page address it refuses, and gives empty notes when there are none", () => {
    expect(read([rel("0.2.0", { html_url: "https://evil.example/tag/v0.2.0" })]).outcome).toMatchObject({ kind: "available", release: { releaseUrl: `${BASE}/tag/v0.2.0` } });
    expect(read([rel("0.2.0", { body: null })]).outcome).toMatchObject({ release: { notes: "" } });
  });
});

describe("checkReleaseUrl (009 FR-024b; checklist CHK019)", () => {
  it("accepts the repository's release pages and files", () => {
    expect(checkReleaseUrl(`${BASE}/tag/v0.2.0`, REPO, "page")).toBe(true);
    expect(checkReleaseUrl(`${BASE}/download/v0.2.0/Vesta-0.2.0-mac-arm64.zip`, REPO, "file")).toBe(true);
    expect(checkReleaseUrl("https://github.com/owner/Vesta/releases/tag/v0.2.0", REPO, "page")).toBe(true);
  });

  it("refuses every other address", () => {
    for (const bad of [
      "http://github.com/OWNER/vesta/releases/tag/v0.2.0",
      "https://github.com.evil.example/OWNER/vesta/releases/tag/v0.2.0",
      "https://api.github.com/OWNER/vesta/releases/tag/v0.2.0",
      "https://user@github.com/OWNER/vesta/releases/tag/v0.2.0",
      "https://github.com:444/OWNER/vesta/releases/tag/v0.2.0",
      "https://github.com/OTHER/vesta/releases/tag/v0.2.0",
      "https://github.com/OWNER/vesta2/releases/tag/v0.2.0",
      "https://github.com/OWNER/vesta/releases/../../x",
      "https://github.com/OWNER/vesta/releases/%2e%2e/%2e%2e/x",
      "https://github.com/OWNER/vesta/releases/%2E%2E/x",
      "file:///OWNER/vesta/releases/x",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(checkReleaseUrl(bad, REPO, "page"), bad).toBe(false);
    }
    expect(checkReleaseUrl(`${BASE}/tag/v0.2.0`, REPO, "file")).toBe(false);
  });
});

describe("pickFile (009 FR-024c, research §9)", () => {
  it("picks the one file for this system and processor", () => {
    expect(pickFile(assets("0.2.0"), "0.2.0", "darwin", "arm64", REPO)).toBe(`${BASE}/download/v0.2.0/Vesta-0.2.0-mac-arm64.zip`);
    expect(pickFile(assets("0.2.0"), "0.2.0", "darwin", "x64", REPO)).toBe(`${BASE}/download/v0.2.0/Vesta-0.2.0-mac-x64.zip`);
    expect(pickFile(assets("0.2.0"), "0.2.0", "linux", "x64", REPO)).toBe(`${BASE}/download/v0.2.0/Vesta-0.2.0-linux-x64.AppImage`);
    expect(pickFile(assets("0.2.0"), "0.2.0", "win32", "x64", REPO)).toBe(`${BASE}/download/v0.2.0/Vesta-0.2.0-win-x64-portable.exe`);
  });

  it("accepts a universal macOS build and the x86_64 spelling", () => {
    expect(pickFile(assets("0.2.0", ["Vesta-0.2.0-mac-universal.zip"]), "0.2.0", "darwin", "arm64", REPO)).toContain("mac-universal.zip");
    expect(pickFile(assets("0.2.0", ["Vesta-0.2.0-linux-x86_64.AppImage"]), "0.2.0", "linux", "x64", REPO)).toContain("linux-x86_64.AppImage");
  });

  it("offers nothing when no file or several files match, or the name is another version", () => {
    expect(pickFile(assets("0.2.0", ["Vesta-0.2.0-linux-x64.tar.gz"]), "0.2.0", "linux", "x64", REPO)).toBeNull();
    expect(pickFile(assets("0.2.0", ["Vesta-0.2.0-mac-arm64.zip", "Vesta-0.2.0-mac-universal.zip"]), "0.2.0", "darwin", "arm64", REPO)).toBeNull();
    expect(pickFile(assets("0.2.0", ["Vesta-0.1.0-mac-arm64.zip"]), "0.2.0", "darwin", "arm64", REPO)).toBeNull();
    expect(pickFile(assets("0.2.0"), "0.2.0", "freebsd", "x64", REPO)).toBeNull();
    expect(pickFile([{ name: "Vesta-0.2.0-mac-arm64.zip", browser_download_url: "https://evil.example/x.zip" }], "0.2.0", "darwin", "arm64", REPO)).toBeNull();
  });

  it("names the system for the Download link", () => {
    expect(systemOf("darwin")).toBe("macOS");
    expect(systemOf("linux")).toBe("Linux");
    expect(systemOf("win32")).toBe("Windows");
  });
});

describe("a beta's update check (017 FR-003, FR-003a, PRD Q260)", () => {
  const betaNames = (v: string) => [`Vesta-${v}-linux-x86_64.AppImage`, `Vesta-${v}-linux-x86_64.tar.gz`, `Vesta-${v}-win-x64-portable.exe`, `Vesta-${v}-win-x64.zip`];

  it("offers a beta the release with the same number", () => {
    const r = read([rel("0.1.0", { assets: assets("0.1.0", betaNames("0.1.0")) })], "0.1.0-beta.1", "linux", "x64");
    expect(r.outcome).toMatchObject({
      kind: "available",
      release: { version: "0.1.0", fileUrl: `${BASE}/download/v0.1.0/Vesta-0.1.0-linux-x86_64.AppImage` },
    });
  });

  it("never offers another beta, flagged as a pre-release or only tagged as one", () => {
    expect(read([rel("0.1.0-beta.2", { prerelease: true })], "0.1.0-beta.1").outcome).toEqual({ kind: "upToDate" });
    const r = read([rel("0.1.0-beta.2")], "0.1.0-beta.1");
    expect(r.outcome).toEqual({ kind: "upToDate" });
    expect(r.ignored).toEqual([]);
  });

  it("is up to date when the only release is older than the beta", () => {
    expect(read([rel("0.0.9")], "0.1.0-beta.1").outcome).toEqual({ kind: "upToDate" });
  });

  it("keeps a release up to date with itself", () => {
    expect(read([rel("0.1.0")], "0.1.0").outcome).toEqual({ kind: "upToDate" });
  });

  it("reads a beta file name as its system, processor and format", () => {
    const m = FILE.exec("Vesta-0.1.0-beta.2-win-x64-portable.exe");
    expect(m?.slice(1)).toEqual(["0.1.0-beta.2", "win", "x64", "-portable", "exe"]);
    expect(FILE.exec("Vesta-0.1.0-beta.2-linux-x86_64.AppImage")?.slice(1)).toEqual(["0.1.0-beta.2", "linux", "x86_64", undefined, "AppImage"]);
    expect(FILE.exec("Vesta-0.1.0-rc.1-linux-x86_64.AppImage")).toBeNull();
  });
});
