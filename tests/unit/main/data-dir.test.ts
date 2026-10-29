import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDataDir, resolveDataDir } from "../../../src/main/data-dir";
import { tempDir } from "../db/helpers";

const unix = process.platform !== "win32";

describe("L9 the data folder is owner-only (010 FR-023, research §5)", () => {
  let root: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir: root, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it.skipIf(!unix)("L9 a new data folder is created with mode 0700", () => {
    const dir = join(root, "Vesta");
    expect(ensureDataDir(dir)).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it.skipIf(!unix)("L9 an existing wider folder is tightened at start", () => {
    const dir = join(root, "Vesta");
    mkdirSync(dir);
    chmodSync(dir, 0o755);
    expect(ensureDataDir(dir)).toBe(false);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("L9 a chmod failure is logged once and does not stop the start", () => {
    const warnings: string[] = [];
    const dir = join(root, "Vesta");
    const log = { warn: (event: string) => warnings.push(event) };
    mkdirSync(dir);
    chmodSync(dir, 0o755);
    expect(ensureDataDir(dir, { log, chmod: () => { throw new Error("EPERM"); } })).toBe(false);
    expect(existsSync(dir)).toBe(true);
    expect(warnings).toEqual(["data-dir.chmod-failed"]);
  });
});

describe("L9 tightening keeps a deliberately narrower folder as it is (010 FR-023, 001 FR-038a)", () => {
  let root: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir: root, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it.skipIf(!unix)("L9 a read-only folder (0500) stays read-only; a 0770 folder loses the group bits", () => {
    const ro = join(root, "ro");
    mkdirSync(ro);
    chmodSync(ro, 0o500);
    ensureDataDir(ro);
    expect(statSync(ro).mode & 0o777).toBe(0o500);
    chmodSync(ro, 0o700);
    const group = join(root, "group");
    mkdirSync(group);
    chmodSync(group, 0o770);
    ensureDataDir(group);
    expect(statSync(group).mode & 0o777).toBe(0o700);
  });
});

describe("017 SC-004, FR-015: a packaged build's data folder is the system's app data path", () => {
  const paths: Record<string, string> = {
    darwin: "/Users/me/Library/Application Support/Vesta",
    linux: "/home/me/.config/Vesta",
    win32: "C:\\Users\\me\\AppData\\Roaming\\Vesta",
  };
  const saved = process.env["VESTA_DATA_DIR"];
  afterEach(() => {
    if (saved === undefined) delete process.env["VESTA_DATA_DIR"];
    else process.env["VESTA_DATA_DIR"] = saved;
  });

  it.each(Object.entries(paths))("%s: whatever VESTA_DATA_DIR says, so every format and replacement shares it", (_platform, userData) => {
    process.env["VESTA_DATA_DIR"] = "/tmp/elsewhere";
    expect(resolveDataDir({ isPackaged: true, getPath: () => userData })).toBe(userData);
  });

  it("an unpackaged build still honours VESTA_DATA_DIR (development and tests)", () => {
    process.env["VESTA_DATA_DIR"] = "/tmp/elsewhere";
    expect(resolveDataDir({ isPackaged: false, getPath: () => paths["linux"] ?? "" })).toBe("/tmp/elsewhere");
  });
});
