import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertOwnedDir, openReadOnlyCopy, removeTempDirs, sweepTempDirs } from "../../../src/main/startup/read-only";
import { tempDir } from "../db/helpers";

const log = { warn: () => undefined, error: () => undefined, info: () => undefined, debug: () => undefined } as never;

describe("M3 temporary folders are random, owned and removed (010 FR-008, research §5)", () => {
  let root: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir: root, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it("M3 assertOwnedDir accepts an owned folder and rejects a link, a file and another owner", () => {
    const owned = join(root, "owned");
    mkdirSync(owned);
    const uid = process.getuid?.() ?? null;
    expect(() => { assertOwnedDir(owned, uid); }).not.toThrow();
    writeFileSync(join(root, "file"), "x");
    expect(() => { assertOwnedDir(join(root, "file"), uid); }).toThrow(/not a directory/);
    symlinkSync(owned, join(root, "link"));
    expect(() => { assertOwnedDir(join(root, "link"), uid); }).toThrow(/symbolic link/);
    if (uid !== null) expect(() => { assertOwnedDir(owned, uid + 1); }).toThrow(/owned/);
    expect(() => { assertOwnedDir(join(root, "missing"), uid); }).toThrow();
  });

  it("M3 openReadOnlyCopy makes a fresh vesta-readonly-* folder under the given temp root, registered for removal", () => {
    const registered: string[] = [];
    const dataDir = join(root, "data");
    mkdirSync(dataDir);
    const a = openReadOnlyCopy(dataDir, log, { tempRoot: root, register: (d) => registered.push(d) });
    const b = openReadOnlyCopy(dataDir, log, { tempRoot: root, register: (d) => registered.push(d) });
    a.close();
    b.close();
    expect(registered).toHaveLength(2);
    expect(registered[0]).not.toBe(registered[1]);
    for (const d of registered) {
      expect(d.startsWith(join(root, "vesta-readonly-"))).toBe(true);
      expect(lstatSync(d).isDirectory()).toBe(true);
    }
  });

  it("M3 removeTempDirs removes what was registered and logs what it cannot", () => {
    const a = join(root, "a");
    mkdirSync(a);
    writeFileSync(join(a, "f"), "x");
    const warnings: string[] = [];
    const logger = { warn: (event: string) => warnings.push(event), error: () => undefined, info: () => undefined, debug: () => undefined } as never;
    removeTempDirs([a, join(root, "never-existed")], logger);
    expect(existsSync(a)).toBe(false);
    expect(warnings).toEqual([]); // a missing folder is not a failure
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("M3 the start-time sweep of stale temporary folders (010 FR-008, research §15)", () => {
  let root: string;
  let cleanup: () => void;
  const log = { warn: () => undefined, info: () => undefined } as never;
  beforeEach(() => {
    ({ dir: root, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it("M3 removes owned folders of dead runs, keeps ours, a live run's and a foreign-owned one", () => {
    const stale = join(root, "vesta-profile-aaaaaa");
    mkdirSync(stale);
    writeFileSync(join(stale, "vesta.pid"), "999999");
    const unmarked = join(root, "vesta-readonly-bbbbbb");
    mkdirSync(unmarked);
    const live = join(root, "vesta-profile-cccccc");
    mkdirSync(live);
    writeFileSync(join(live, "vesta.pid"), "4242");
    const ours = join(root, "vesta-profile-dddddd");
    mkdirSync(ours);
    const other = join(root, "not-vesta-eeeeee");
    mkdirSync(other);
    const removed = sweepTempDirs(root, [ours], log, { isAlive: (pid) => pid === 4242 });
    expect(removed.sort()).toEqual([stale, unmarked].sort());
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(unmarked)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(ours)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it("M3 openReadOnlyCopy marks its folder with this process's id", () => {
    const dataDir = join(root, "data");
    mkdirSync(dataDir);
    const registered: string[] = [];
    const db = openReadOnlyCopy(dataDir, log, { tempRoot: root, register: (d) => registered.push(d) });
    db.close();
    expect(readFileSync(join(registered[0] ?? "", "vesta.pid"), "utf8")).toBe(String(process.pid));
    expect(sweepTempDirs(root, [], log)).toEqual([]); // our own live pid keeps it
  });
});
