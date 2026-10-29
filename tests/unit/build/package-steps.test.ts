import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEnv, builderRuns, checkBetaVersion, fillGuide, fillVersion, handoutFiles, isCleanTree, runPackage, type Runner } from "../../../scripts/lib/package-steps.ts";
import { checkSums } from "../../../scripts/lib/sums.ts";

const V = "0.1.0-beta.1";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("package steps (017 FR-002, FR-002a, FR-002b, FR-004, FR-005, FR-005b, FR-007)", () => {
  it("refuses a version without a -beta.N tag", () => {
    expect(() => {
      checkBetaVersion("0.1.0");
    }).toThrow("version must carry a -beta.N tag");
    expect(() => {
      checkBetaVersion("0.1.0-rc.1");
    }).toThrow("version must carry a -beta.N tag");
    expect(() => {
      checkBetaVersion(V);
    }).not.toThrow();
  });

  it("removes release tokens and signing material, and turns identity discovery off", () => {
    const env = buildEnv({
      PATH: "/bin",
      HOME: "/h",
      GH_TOKEN: "t",
      GITHUB_TOKEN: "t",
      CSC_LINK: "x",
      CSC_KEY_PASSWORD: "x",
      CSC_NAME: "x",
      WIN_CSC_LINK: "x",
      WIN_CSC_KEY_PASSWORD: "x",
      APPLE_ID: "x",
      APPLE_APP_SPECIFIC_PASSWORD: "x",
      APPLE_TEAM_ID: "x",
      APPLE_API_KEY: "x",
      APPLE_API_KEY_ID: "x",
      APPLE_API_ISSUER: "x",
      APPLE_KEYCHAIN_PROFILE: "x",
    });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", CSC_IDENTITY_AUTO_DISCOVERY: "false" });
  });

  it("reads git's porcelain output", () => {
    expect(isCleanTree("")).toBe(true);
    expect(isCleanTree("\n")).toBe(true);
    expect(isCleanTree(" M src/x.ts\n")).toBe(false);
  });

  it("fills the version and the commit into the guide", () => {
    expect(fillGuide("v{{version}} at {{commit}} ({{version}})", V, COMMIT)).toBe(`v${V} at ${COMMIT} (${V})`);
  });
  it("fills every version placeholder", () => {
    expect(fillVersion("Beta {{version}} … {{version}}", V)).toBe(`Beta ${V} … ${V}`);
  });

  it("lists the handout and never a macOS file", () => {
    expect(handoutFiles(V)).toEqual([
      `Vesta-${V}-linux-x86_64.AppImage`,
      `Vesta-${V}-linux-x86_64.tar.gz`,
      `Vesta-${V}-win-x64-portable.exe`,
      `Vesta-${V}-win-x64.zip`,
      "LICENSE",
      "TRADEMARKS.md",
      "beta-testing.md",
    ]);
    expect(handoutFiles(V).some((n) => n.includes("-mac-"))).toBe(false);
    // PRD Q292: no source archive; the guide names the repository and the commit instead.
    expect(handoutFiles(V).some((n) => n.includes("source"))).toBe(false);
  });

  it("runs electron-builder once per system, never publishing", () => {
    expect(builderRuns("--all")).toEqual([
      { system: "macOS", args: ["--mac", "--publish", "never"] },
      { system: "Linux", args: ["--linux", "--publish", "never"] },
      { system: "Windows", args: ["--win", "--publish", "never"] },
    ]);
    expect(builderRuns("--linux")).toEqual([{ system: "Linux", args: ["--linux", "--publish", "never"] }]);
  });
});

/** A project folder and a runner that fakes git, electron-vite and electron-builder. */
function project(failOn: string | null, porcelain = "", iconComposer = true) {
  const base = mkdtempSync(join(tmpdir(), "vesta-package-"));
  const root = join(base, "project");
  mkdirSync(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: V }));
  writeFileSync(join(root, "LICENSE"), "AGPL");
  writeFileSync(join(root, "TRADEMARKS.md"), "# Vesta name and identity\n");
  // The tester guide lives outside the project and is passed in with --guide.
  const guide = join(base, "beta-testing.md");
  writeFileSync(guide, "# Vesta {{version}}\nSource: commit {{commit}}\n");
  const calls: string[] = [];
  const runner: Runner = {
    exec(cmd, args) {
      calls.push([cmd, ...args].join(" "));
      if (cmd === "git" && args[0] === "status") return Promise.resolve(porcelain);
      if (cmd === "git" && args[0] === "rev-parse") return Promise.resolve(`${COMMIT}\n`);
      if (args.includes("electron-builder")) {
        const system = args.includes("--mac") ? "mac" : args.includes("--linux") ? "linux" : "win";
        if (failOn === system) return Promise.reject(new Error("exit 1"));
        const out = join(root, "release");
        mkdirSync(out, { recursive: true });
        const names =
          system === "mac"
            ? [`Vesta-${V}-mac-arm64.zip`]
            : system === "linux"
              ? [`Vesta-${V}-linux-x86_64.AppImage`, `Vesta-${V}-linux-x86_64.tar.gz`]
              : [`Vesta-${V}-win-x64-portable.exe`, `Vesta-${V}-win-x64.zip`];
        for (const n of names) writeFileSync(join(out, n), n);
      }
      return Promise.resolve("");
    },
    icons() {
      calls.push("icons");
      return iconComposer;
    },
    notices(dir) {
      calls.push("notices");
      writeFileSync(join(dir, "THIRD_PARTY_NOTICES.txt"), "notices");
    },
  };
  return { root, guide, runner, calls };
}

describe("runPackage (017 FR-005, FR-005b, FR-007, research §8)", () => {
  it("builds the three systems and writes the handout folder with matching checksums", async () => {
    const { root, guide, runner, calls } = project(null);
    mkdirSync(join(root, "release"));
    writeFileSync(join(root, "release", "Vesta-0.0.1-beta.9-win-x64.zip"), "old");
    await runPackage({ root, mode: "--all", env: { PATH: "/bin", GH_TOKEN: "t" }, guide }, runner);
    expect(existsSync(join(root, "release", "Vesta-0.0.1-beta.9-win-x64.zip"))).toBe(false);
    const handout = join(root, "release", "handout");
    expect(readdirSync(handout).sort()).toEqual([...handoutFiles(V), "SHA256SUMS"].sort());
    expect(readFileSync(join(handout, "beta-testing.md"), "utf8")).toBe(`# Vesta ${V}\nSource: commit ${COMMIT}\n`);
    expect(readFileSync(join(handout, "TRADEMARKS.md"), "utf8")).toBe("# Vesta name and identity\n");
    expect(await checkSums(handout)).toEqual({ missing: [], extra: [], mismatched: [] });
    expect(existsSync(join(root, "THIRD_PARTY_NOTICES.txt"))).toBe(false);
    expect(calls.filter((c) => c.includes("electron-builder"))).toHaveLength(3);
    expect(calls).toContain("git rev-parse HEAD");
    expect(calls.some((c) => c.startsWith("git archive"))).toBe(false);
  });

  it("names the system that failed, writes no handout and still deletes the notices", async () => {
    const { root, guide, runner } = project("linux");
    await expect(runPackage({ root, mode: "--all", env: {}, guide }, runner)).rejects.toThrow("Build failed for Linux");
    expect(existsSync(join(root, "release", "handout"))).toBe(false);
    expect(existsSync(join(root, "THIRD_PARTY_NOTICES.txt"))).toBe(false);
  });

  it("builds macOS with the .icns when actool rejects the Icon Composer bundle (research §3)", async () => {
    const { root, guide, runner, calls } = project(null, "", false);
    await runPackage({ root, mode: "--all", env: {}, guide }, runner);
    const builds = calls.filter((c) => c.includes("electron-builder"));
    expect(builds.find((c) => c.includes("--mac"))).toContain("-c.mac.icon=build/icon.icns");
    expect(builds.filter((c) => c.includes("-c.mac.icon"))).toHaveLength(1);
  });

  it("refuses to build a handout with uncommitted changes", async () => {
    const { root, guide, runner, calls } = project(null, " M src/x.ts\n");
    await expect(runPackage({ root, mode: "--all", env: {}, guide }, runner)).rejects.toThrow(/uncommitted/);
    expect(calls.some((c) => c.includes("electron-builder"))).toBe(false);
  });

  it("refuses to build the handout without the tester guide, and names a missing one", async () => {
    const { root, runner, calls } = project(null);
    await expect(runPackage({ root, mode: "--all", env: {} }, runner)).rejects.toThrow(/--guide/);
    await expect(runPackage({ root, mode: "--all", env: {}, guide: join(root, "missing.md") }, runner)).rejects.toThrow(/not found/);
    expect(calls).toEqual([]);
  });

  it("builds one system without a handout or a clean-tree check", async () => {
    const { root, runner, calls } = project(null, " M src/x.ts\n");
    await runPackage({ root, mode: "--mac", env: {} }, runner);
    expect(existsSync(join(root, "release", `Vesta-${V}-mac-arm64.zip`))).toBe(true);
    expect(existsSync(join(root, "release", "handout"))).toBe(false);
    expect(calls.some((c) => c.startsWith("git status"))).toBe(false);
  });
});
