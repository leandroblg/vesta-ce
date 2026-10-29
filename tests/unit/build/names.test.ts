/**
 * 017 FR-001, FR-002b, FR-003, FR-009, FR-016 (research §1, §2): electron-builder.yml makes the five beta files with
 * feature 009's names, ad-hoc signs macOS, signs nothing else, publishes nothing and ships each system's own SQLite
 * module. js-yaml is electron-builder's own dependency (installed at the top of node_modules), not the project's.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FILE } from "../../../src/domain/updates/releases";

const root = resolve(import.meta.dirname, "../../..");
const { load } = createRequire(import.meta.url)("js-yaml") as { load: (text: string) => unknown };

interface Target {
  target: string;
  arch: string[];
}
interface Config {
  appId: string;
  productName: string;
  asar: boolean;
  asarUnpack: string[];
  npmRebuild: boolean;
  publish: null;
  toolsets: { appimage: string; nsis: string };
  files: string[];
  extraResources: { from: string; to: string }[];
  directories: { output: string };
  mac: { target: Target[]; extraResources: { from: string; to: string }[]; identity: string; hardenedRuntime: boolean; notarize: boolean; icon: string; artifactName: string; files: string[] };
  linux: { target: Target[]; executableArgs: string[]; executableName: string; icon: string; artifactName: string; files: string[] };
  win: { target: Target[]; signExecutable: boolean; icon: string; artifactName: string; files: string[] };
  portable: { artifactName: string };
}

const config = load(readFileSync(join(root, "electron-builder.yml"), "utf8")) as Config;
const expand = (pattern: string, ext: string) => pattern.replaceAll("${version}", "0.1.0-beta.1").replaceAll("${ext}", ext);

describe("electron-builder.yml (017)", () => {
  it("names the five files by feature 009's rule (FR-003)", () => {
    const names = [
      expand(config.mac.artifactName, "zip"),
      expand(config.linux.artifactName, "AppImage"),
      expand(config.linux.artifactName, "tar.gz"),
      expand(config.portable.artifactName, "exe"),
      expand(config.win.artifactName, "zip"),
    ];
    expect(names).toEqual([
      "Vesta-0.1.0-beta.1-mac-arm64.zip",
      "Vesta-0.1.0-beta.1-linux-x86_64.AppImage",
      "Vesta-0.1.0-beta.1-linux-x86_64.tar.gz",
      "Vesta-0.1.0-beta.1-win-x64-portable.exe",
      "Vesta-0.1.0-beta.1-win-x64.zip",
    ]);
    const read = (name: string) => FILE.exec(name)?.slice(1);
    expect(read(names[0] ?? "")).toEqual(["0.1.0-beta.1", "mac", "arm64", undefined, "zip"]);
    expect(read(names[1] ?? "")).toEqual(["0.1.0-beta.1", "linux", "x86_64", undefined, "AppImage"]);
    expect(read(names[3] ?? "")).toEqual(["0.1.0-beta.1", "win", "x64", "-portable", "exe"]);
    expect(read(names[4] ?? "")).toEqual(["0.1.0-beta.1", "win", "x64", undefined, "zip"]);
    // The .tar.gz is a handout and release format, never an update-check pick (research §6).
    expect(FILE.exec(names[2] ?? "")).toBeNull();
  });

  it("builds the release formats for the three systems (FR-001)", () => {
    expect(config.mac.target).toEqual([{ target: "zip", arch: ["arm64"] }]);
    expect(config.linux.target).toEqual([
      { target: "AppImage", arch: ["x64"] },
      { target: "tar.gz", arch: ["x64"] },
    ]);
    expect(config.win.target).toEqual([
      { target: "portable", arch: ["x64"] },
      { target: "zip", arch: ["x64"] },
    ]);
    expect(config.productName).toBe("Vesta");
    expect(config.directories.output).toBe("release");
  });

  it("ad-hoc signs macOS, signs nothing else, publishes nothing (FR-002a, FR-002b, FR-009, research §1)", () => {
    expect(config.mac.identity).toBe("-");
    expect(config.mac.hardenedRuntime).toBe(false);
    expect(config.mac.notarize).toBe(false);
    expect(config.win.signExecutable).toBe(false);
    expect(config.publish).toBeNull();
  });

  it("builds the portable .exe with NSIS 3.12, which runs on Apple Silicon without Rosetta (research §2, T020)", () => {
    expect(config.toolsets.nsis).toBe("1.2.1");
  });

  it("uses the static AppImage runtime with no sandbox switch in its desktop entry (Q266, research §2)", () => {
    expect(config.toolsets.appimage).toBe("1.0.3");
    expect(config.linux.executableArgs).toEqual([]);
    expect(config.linux.executableName).toBe("vesta");
  });

  it("ships each system's own SQLite module, unpacked, with no rebuild (FR-016, research §2)", () => {
    expect(config.npmRebuild).toBe(false);
    expect(config.asar).toBe(true);
    expect(config.asarUnpack).toContain("**/*.node");
    const prebuilds = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "linuxmusl-x64", "linuxmusl-arm64", "win32-x64", "win32-arm64"];
    const kept = (files: string[]) => prebuilds.filter((p) => !files.includes(`!node_modules/better-sqlite3/prebuilds/${p}.node`));
    expect(kept(config.mac.files)).toEqual(["darwin-arm64"]);
    expect(kept(config.linux.files)).toEqual(["linux-x64"]);
    expect(kept(config.win.files)).toEqual(["win32-x64"]);
  });

  it("gives each system its icon (FR-011, FR-011a)", () => {
    expect(["build/icon.icns", "build/Vesta.icon"]).toContain(config.mac.icon);
    expect(config.linux.icon).toBe("build/icons");
    expect(config.win.icon).toBe("build/icon.ico");
    expect(config.extraResources).toContainEqual({ from: "build/icons/512x512.png", to: "icon.png" });
  });

  it("ships Chromium's and Electron's notices inside the macOS app, as Linux and Windows have them beside theirs (FR-013)", () => {
    expect(config.mac.extraResources).toEqual([
      { from: "node_modules/electron/dist/LICENSES.chromium.html", to: "LICENSES.chromium.html" },
      { from: "node_modules/electron/dist/LICENSE", to: "LICENSE.electron.txt" },
    ]);
  });
});
