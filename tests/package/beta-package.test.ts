/**
 * 017 FR-017, FR-018, FR-018a (research §5): the packaged macOS app, run as a tester would, without Playwright.
 * Playwright's Electron launcher passes --inspect and --remote-debugging-port, which a packaged build refuses (010
 * FR-022), so this test runs the real binary, reads its log and its data, and looks inside its app.asar. Its data
 * folder is a temporary one, through Chromium's --user-data-dir; the maintainer's own is never used.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFile, listPackage } from "@electron/asar";
import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { collectPackages } from "../../scripts/lib/notices.ts";
import { seedSetting, seedTasks, task } from "../e2e/fixtures/seed";
import { netLogHosts } from "../unit/fixtures/netlog";
import { artifact, missingBuild, releaseDir, repoRoot, version } from "./release";

const skip = missingBuild(artifact.mac);

/** Unzips the macOS build into `dir`, as a tester replacing the app would (research §5). */
function unzipApp(dir: string): string {
  rmSync(dir, { recursive: true, force: true });
  execFileSync("ditto", ["-x", "-k", join(releaseDir, artifact.mac), dir]);
  return join(dir, "Vesta.app");
}

const binary = (app: string) => join(app, "Contents", "MacOS", "Vesta");
const asarOf = (app: string) => join(app, "Contents", "Resources", "app.asar");

/** The log's entries, parsed. */
function logEntries(dataDir: string): Record<string, unknown>[] {
  const dir = join(dataDir, "logs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n"))
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Runs the app on `dataDir` until it logs app.started, then quits it; returns that entry. */
async function runOnce(app: string, dataDir: string, args: string[] = []): Promise<Record<string, unknown>> {
  const seen = logEntries(dataDir).length;
  const child = spawn(binary(app), [`--user-data-dir=${dataDir}`, ...args], { stdio: "ignore" });
  try {
    for (let waited = 0; waited < 30_000; waited += 250) {
      const started = logEntries(dataDir)
        .slice(seen)
        .find((e) => e["event"] === "app.started");
      if (started !== undefined) {
        // Let the window load and the first idle work settle before quitting.
        await new Promise((r) => setTimeout(r, 2_000));
        return started;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("the packaged app did not log app.started within 30 s");
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((done) => {
      if (child.exitCode !== null) done();
      else
        child.once("exit", () => {
          done();
        });
    });
  }
}

const tasksIn = (dataDir: string) => {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    return (db.prepare("select title_md from tasks order by position").all() as { title_md: string }[]).map((r) => r.title_md);
  } finally {
    db.close();
  }
};

describe.skipIf(skip !== null)(skip ?? "the packaged macOS app (FR-017)", () => {
  const root = mkdtempSync(join(tmpdir(), "vesta-packaged-"));
  const dataDir = join(root, "Vesta");
  let app = "";

  beforeAll(() => {
    // The data a beta left behind: one task, the update check off so the app never contacts GitHub (FR-018a).
    seedTasks(dataDir, [task({ titleMd: "beta survives" })]);
    seedSetting(dataDir, "autoUpdateCheck", false);
    seedSetting(dataDir, "language", "en");
    app = unzipApp(join(root, "app"));
  });

  it("starts on the given data folder, with the beta version, and keeps the data across a replacement", async () => {
    // FR-018a: Chromium's NetLog records every lookup and connection; the run makes none.
    const netLog = join(root, "net.json");
    const first = await runOnce(app, dataDir, [`--log-net-log=${netLog}`]);
    expect(first).toMatchObject({ version, startup: "ok" });
    expect(netLogHosts(netLog)).toEqual([]);
    expect(String(first["dataDir"])).toContain(root.split("/").pop() ?? "");
    expect(tasksIn(dataDir)).toEqual(["beta survives"]);

    // The replacement: the old app removed, a fresh copy unzipped in its place (FR-015, SC-004).
    app = unzipApp(join(root, "app"));
    const second = await runOnce(app, dataDir);
    expect(second).toMatchObject({ version, startup: "ok" });
    expect(tasksIn(dataDir)).toEqual(["beta survives"]);
  });

  it("shows the beta version in About: the packaged package.json carries it", () => {
    const pkg = JSON.parse(extractFile(asarOf(app), "package.json").toString("utf8")) as { version: string };
    expect(pkg.version).toBe(version);
  });

  it("bundles the third-party notices the Third-Party Licenses window shows", () => {
    const scripts = listPackage(asarOf(app), { isPack: false }).filter((p) => /out\/renderer\/assets\/.*\.js$/.test(p));
    const text = scripts.map((p) => extractFile(asarOf(app), p.replace(/^[/\\]/, "")).toString("utf8")).join("\n");
    for (const name of ["better-sqlite3", "react", "electron", "LICENSES.chromium.html"]) expect(text, name).toContain(name);
    expect(text).toContain("Third-party notices for Vesta");
    // SC-005: every installed production package, plus Electron.
    const ls = JSON.parse(execFileSync("npm", ["ls", "--omit=dev", "--all", "--json", "--long"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })) as Parameters<
      typeof collectPackages
    >[0];
    expect(text).toContain(`It bundles the ${String(collectPackages(ls).length + 1)} packages below`);
  });

  it("carries Chromium's and Electron's own notices inside the app (FR-013)", () => {
    for (const f of ["LICENSES.chromium.html", "LICENSE.electron.txt"]) expect(existsSync(join(app, "Contents", "Resources", f)), f).toBe(true);
  });

  it.each(["--remote-debugging-port=0", "--inspect=0"])("refuses developer access: %s", (arg) => {
    const r = spawnSync(binary(app), [`--user-data-dir=${join(root, "refused")}`, arg], { encoding: "utf8", timeout: 20_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Vesta refuses to start with");
  });
});
