/**
 * 017 FR-016, FR-019 (research §9, §12): the Linux and Windows files hold a SQLite module built for their system, the
 * icon and the third-party notices; the AppImage and the portable .exe are checked by header; the handout's guide names
 * the repository and the commit the build was made from (PRD Q292). Run by `npm run test:package` after `npm run package:beta`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFile, listPackage } from "@electron/asar";
import { NtExecutable, NtExecutableResource } from "resedit";
import { beforeAll, describe, expect, it } from "vitest";
import { readZip, type ZipEntryInfo } from "../unit/fixtures/zip";
import { isAppImageX64, isElfX64, isNsisStub, isPe32PlusX64 } from "./binary";
import { RELEASE_REPO } from "../../src/main/updates/repo";
import { artifact, handoutDir, missingBuild, releaseDir, version } from "./release";

const RT_GROUP_ICON = 14;
const tar = (args: string[]) => execFileSync("tar", args, { maxBuffer: 256 * 1024 * 1024 });
/** The one entry whose path ends with `suffix` (archives wrap everything in one top-level folder). */
const bySuffix = (names: Iterable<string>, suffix: string) => [...names].filter((n) => n.endsWith(suffix));

/** The notices inside an app.asar: the renderer bundle carries THIRD_PARTY_NOTICES.txt's text (LicenseView). */
function asarHasNotices(asar: string): boolean {
  const scripts = listPackage(asar, { isPack: false }).filter((p) => /out\/renderer\/assets\/.*\.js$/.test(p));
  return scripts.some((p) => {
    const text = extractFile(asar, p.replace(/^[/\\]/, "")).toString("utf8");
    return text.includes("Third-party notices for Vesta") && text.includes("LICENSES.chromium.html");
  });
}

const iconGroups = (exe: Buffer) => NtExecutableResource.from(NtExecutable.from(exe, { ignoreCert: true })).entries.filter((e) => e.type === RT_GROUP_ICON);

describe.skipIf(missingBuild(artifact.tarGz) !== null)(missingBuild(artifact.tarGz) ?? "Linux .tar.gz (FR-016, FR-019)", () => {
  const file = join(releaseDir, artifact.tarGz);
  let names: string[] = [];
  let out = "";
  beforeAll(() => {
    names = tar(["-tzf", file]).toString("utf8").split("\n").filter(Boolean);
    out = mkdtempSync(join(tmpdir(), "vesta-targz-"));
  });
  const extract = (suffix: string) => {
    const [name] = bySuffix(names, suffix);
    if (name === undefined) throw new Error(`no ${suffix} in ${artifact.tarGz}`);
    tar(["-xzf", file, "-C", out, name]);
    return join(out, name);
  };

  it("holds the Linux x86-64 SQLite module and no other system's", () => {
    expect(isElfX64(readFileSync(extract("app.asar.unpacked/node_modules/better-sqlite3/prebuilds/linux-x64.node")))).toBe(true);
    expect(bySuffix(names, ".node").filter((n) => n.includes("better-sqlite3/prebuilds/"))).toHaveLength(1);
  });

  it("holds the window icon, the vesta executable and the notices", () => {
    expect(readFileSync(extract("resources/icon.png")).subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(isElfX64(readFileSync(extract("/vesta")))).toBe(true);
    expect(asarHasNotices(extract("resources/app.asar"))).toBe(true);
    expect(bySuffix(names, "/LICENSES.chromium.html")).toHaveLength(1);
    expect(bySuffix(names, "/LICENSE.electron.txt")).toHaveLength(1);
  });
});

describe.skipIf(missingBuild(artifact.appImage) !== null)(missingBuild(artifact.appImage) ?? "Linux AppImage (FR-019)", () => {
  it("is an x86-64 AppImage", () => {
    expect(isAppImageX64(readFileSync(join(releaseDir, artifact.appImage)).subarray(0, 4 * 1024 * 1024))).toBe(true);
  });

  it("was made from linux-unpacked, which holds the same module, icon and notices", () => {
    const dir = join(releaseDir, "linux-unpacked");
    expect(isElfX64(readFileSync(join(dir, "resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/linux-x64.node")))).toBe(true);
    expect(readdirSync(join(dir, "resources"))).toContain("icon.png");
    expect(asarHasNotices(join(dir, "resources/app.asar"))).toBe(true);
  });
});

describe.skipIf(missingBuild(artifact.winZip) !== null)(missingBuild(artifact.winZip) ?? "Windows .zip (FR-011, FR-016, FR-019)", () => {
  let all = new Map<string, ZipEntryInfo>();
  beforeAll(async () => {
    all = await readZip(join(releaseDir, artifact.winZip));
  });
  const one = (suffix: string) => {
    const [name] = bySuffix(all.keys(), suffix);
    const entry = name === undefined ? undefined : all.get(name);
    if (entry === undefined) throw new Error(`no ${suffix} in ${artifact.winZip}`);
    return entry.data;
  };

  it("holds the Windows x64 SQLite module and no other system's", () => {
    expect(isPe32PlusX64(one("app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node"))).toBe(true);
    expect(bySuffix(all.keys(), ".node").filter((n) => n.includes("better-sqlite3/prebuilds/"))).toHaveLength(1);
  });

  it("holds Vesta.exe, x64 with the Vesta icon, and the notices", () => {
    const exe = one("Vesta.exe");
    expect(isPe32PlusX64(exe)).toBe(true);
    expect(iconGroups(exe).length).toBeGreaterThan(0);
    const asar = join(mkdtempSync(join(tmpdir(), "vesta-winzip-")), "app.asar");
    writeFileSync(asar, one("resources/app.asar"));
    expect(asarHasNotices(asar)).toBe(true);
    expect(one("LICENSES.chromium.html").length).toBeGreaterThan(0);
    expect(one("LICENSE.electron.txt").length).toBeGreaterThan(0);
  });
});

describe.skipIf(missingBuild(artifact.portable) !== null)(missingBuild(artifact.portable) ?? "Windows portable .exe (FR-011, FR-019)", () => {
  it("is the self-extractor of the x64 app, carrying the Vesta icon", () => {
    const exe = readFileSync(join(releaseDir, artifact.portable));
    expect(isNsisStub(exe)).toBe(true);
    expect(iconGroups(exe).length).toBeGreaterThan(0);
  });

  it("was made from win-unpacked, which holds the same module and notices", () => {
    const dir = join(releaseDir, "win-unpacked");
    expect(isPe32PlusX64(readFileSync(join(dir, "resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node")))).toBe(true);
    expect(asarHasNotices(join(dir, "resources/app.asar"))).toBe(true);
  });
});

const guide = join("handout", "beta-testing.md");
describe.skipIf(missingBuild(guide) !== null)(missingBuild(guide) ?? "handout without the source (PRD Q292)", () => {
  it("ships no source archive and names the repository and the built commit in the guide", () => {
    expect(readdirSync(handoutDir).some((n) => n.includes("source"))).toBe(false);
    const text = readFileSync(join(handoutDir, "beta-testing.md"), "utf8");
    expect(text).toContain(`https://github.com/${RELEASE_REPO.owner}/${RELEASE_REPO.repo}`);
    expect(text).toContain(`v${version}`);
    expect(text).toMatch(/\b[0-9a-f]{40}\b/);
    expect(text).not.toContain("{{");
  });
});
