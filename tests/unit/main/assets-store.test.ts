import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedClock } from "../../../src/domain/clock";
import { isAssetRef } from "../../../src/domain/markdown/assets";
import { AssetError, importBytes, importConfirmed, importPath, resolveForImport, serializeConfirm } from "../../../src/main/assets/store";
import { openDatabase } from "../../../src/main/db/connection";
import { getAsset, listAssetHashes } from "../../../src/main/db/assets-repo";
import { migrate } from "../../../src/main/db/migrate";
import { initFaults } from "../../../src/main/faults";
import { tempDir } from "../db/helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGM4YWT0HxkzoAsAACR1EVnFpgq+AAAAAElFTkSuQmCC",
  "base64",
);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("asset store (FR-027 to FR-029, data-model.md)", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  const store = () => ({ dir, db, clock: fixedClock(1000) });

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    db.close();
    cleanup();
    delete process.env["VESTA_FAULT"];
    initFaults(true);
  });

  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return err instanceof AssetError ? err.code : "other";
    }
    return null;
  };

  it("stores imported bytes as assets/<sha>.<ext> with a row and the sniffed media type", () => {
    const ref = importBytes(store(), { name: "Photo.JPG", bytes: PNG, scope: "details" });
    expect(ref).toEqual({ ref: `assets/${sha(PNG)}.jpg`, name: "Photo.JPG", isImage: true });
    expect(readFileSync(join(dir, "assets", `${sha(PNG)}.jpg`)).equals(PNG)).toBe(true);
    expect(getAsset(db, sha(PNG))).toEqual({
      sha256: sha(PNG),
      ext: "jpg",
      mimeType: "image/png",
      size: PNG.length,
      createdAt: 1000,
      removedAt: null,
    });
  });

  it.each([
    ["Photo.JPG", "jpg"],
    ["a.c++", "c"],
    ["x.tar.gz", "gz"],
    [`x.${"a".repeat(17)}`, ""],
    ["noext", ""],
  ])("keeps the extension rule: %s gives %j", (name, ext) => {
    const bytes = Buffer.from(`file ${name}`);
    const { ref } = importBytes(store(), { name, bytes, scope: "details" });
    expect(isAssetRef(ref)).toBe(true);
    expect(ref).toBe(ext === "" ? `assets/${sha(bytes)}` : `assets/${sha(bytes)}.${ext}`);
    expect(getAsset(db, sha(bytes))?.ext).toBe(ext);
  });

  it("stores identical bytes once", () => {
    const a = importBytes(store(), { name: "a.png", bytes: PNG, scope: "details" });
    const b = importBytes(store(), { name: "copy.png", bytes: PNG, scope: "details" });
    expect(b.ref).toBe(a.ref);
    expect(b.name).toBe("copy.png");
    expect(listAssetHashes(db)).toEqual([sha(PNG)]);
    expect(readdirSync(join(dir, "assets"))).toEqual([`${sha(PNG)}.png`]);
  });

  it("refuses more than 100 MB before writing anything", () => {
    const big = Buffer.alloc(104_857_601);
    expect(code(() => importBytes(store(), { name: "big.mov", bytes: big, scope: "details" }))).toBe("TOO_LARGE");
    expect(listAssetHashes(db)).toEqual([]);
    expect(existsSync(join(dir, "assets")) ? readdirSync(join(dir, "assets")) : []).toEqual([]);
  });

  it("refuses a non-image in the title scope; stores SVG as a file, not an image", () => {
    const pdf = Buffer.from("%PDF-1.7\n");
    expect(code(() => importBytes(store(), { name: "doc.pdf", bytes: pdf, scope: "title" }))).toBe("NOT_IMAGE");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(code(() => importBytes(store(), { name: "logo.svg", bytes: svg, scope: "title" }))).toBe("NOT_IMAGE");
    const ref = importBytes(store(), { name: "logo.svg", bytes: svg, scope: "details" });
    expect(ref.isImage).toBe(false);
    expect(getAsset(db, sha(svg))?.mimeType).toBe("image/svg+xml");
    expect(importBytes(store(), { name: "doc.pdf", bytes: pdf, scope: "details" }).isImage).toBe(false);
    expect(getAsset(db, sha(pdf))?.mimeType).toBe("application/pdf");
  });

  it("imports a regular file by path; a directory or a missing path is NOT_FOUND, a big file TOO_LARGE", () => {
    const outside = join(dir, "outside");
    mkdirSync(outside);
    const file = join(outside, "Report.PDF");
    writeFileSync(file, "%PDF-1.4\n");
    const ref = importPath(store(), { path: file, scope: "details" });
    expect(ref.name).toBe("Report.PDF");
    expect(ref.ref).toBe(`assets/${sha(readFileSync(file))}.pdf`);
    expect(code(() => importPath(store(), { path: outside, scope: "details" }))).toBe("NOT_FOUND");
    expect(code(() => importPath(store(), { path: join(outside, "nope.png"), scope: "details" }))).toBe("NOT_FOUND");
    const sparse = join(outside, "huge.bin");
    writeFileSync(sparse, "");
    truncateSync(sparse, 104_857_601);
    expect(code(() => importPath(store(), { path: sparse, scope: "details" }))).toBe("TOO_LARGE");
    // A file: URL is a path too (FR-027a).
    expect(importPath(store(), { path: `file://${file}`, scope: "details" }).ref).toBe(ref.ref);
  });

  it("an interrupted write leaves no row and no partial file", () => {
    initFaults(false);
    process.env["VESTA_FAULT"] = "asset-write";
    expect(code(() => importBytes(store(), { name: "a.png", bytes: PNG, scope: "details" }))).toBe("other");
    expect(listAssetHashes(db)).toEqual([]);
    expect(readdirSync(join(dir, "assets"))).toEqual([]);
  });
});

describe("M1 confirmed path import (010 FR-001 to FR-003, research §3)", () => {
  let dir: string;
  let outside: string;
  let cleanup: () => void;
  let cleanupOutside: () => void;
  let db: Database.Database;
  const store = () => ({ dir, db, clock: fixedClock(1000) });
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return err instanceof AssetError ? err.code : "other";
    }
    return null;
  };
  const codeOfAsync = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (err) {
      return err instanceof AssetError ? err.code : "other";
    }
    return null;
  };

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    ({ dir: outside, cleanup: cleanupOutside } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    writeFileSync(join(outside, "report.pdf"), "%PDF-1.4 hello");
    mkdirSync(join(outside, "folder"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "x.bin"), "x");
    mkdirSync(join(dir, "backups"));
    writeFileSync(join(dir, "backups", "latest.sqlite"), "b");
  });
  afterEach(() => {
    db.close();
    cleanup();
    cleanupOutside();
  });

  it("M1 resolves an absolute path and a file: URL to the real file, with its name and folder", () => {
    const byPath = resolveForImport(dir, { path: join(outside, "report.pdf"), scope: "details" });
    expect(byPath.name).toBe("report.pdf");
    expect(byPath.size).toBe("%PDF-1.4 hello".length);
    expect(byPath.path).toBe(byPath.folder + "/report.pdf".replace("/", process.platform === "win32" ? "\\" : "/"));
    const byUrl = resolveForImport(dir, { path: `file://${join(outside, "report.pdf")}`, scope: "details" });
    expect(byUrl.path).toBe(byPath.path);
  });

  it("M1 refuses a missing path and a folder as NOT_FOUND, without a dialog", () => {
    expect(codeOf(() => resolveForImport(dir, { path: join(outside, "missing.pdf"), scope: "details" }))).toBe("NOT_FOUND");
    expect(codeOf(() => resolveForImport(dir, { path: join(outside, "folder"), scope: "details" }))).toBe("NOT_FOUND");
  });

  it.each(["data.sqlite", "assets/x.bin", "backups/latest.sqlite", "logs/vesta-001.log"])("M1 refuses a path inside the data folder: %s", (rel) => {
    mkdirSync(join(dir, "logs"), { recursive: true });
    writeFileSync(join(dir, "logs", "vesta-001.log"), "l");
    expect(codeOf(() => resolveForImport(dir, { path: join(dir, rel), scope: "details" }))).toBe("INSIDE_DATA");
  });

  it("M1 refuses a symbolic link that resolves into the data folder", () => {
    symlinkSync(join(dir, "data.sqlite"), join(outside, "innocent.pdf"));
    expect(codeOf(() => resolveForImport(dir, { path: join(outside, "innocent.pdf"), scope: "details" }))).toBe("INSIDE_DATA");
  });

  it("M1 refuses a file over 100 MB before any dialog", () => {
    truncateSync(join(outside, "report.pdf"), 104_857_601);
    expect(codeOf(() => resolveForImport(dir, { path: join(outside, "report.pdf"), scope: "details" }))).toBe("TOO_LARGE");
  });

  it("M1 stores nothing when the user cancels, and the copy when they confirm, showing name and folder", async () => {
    const resolved = resolveForImport(dir, { path: join(outside, "report.pdf"), scope: "details" });
    const asked: { name: string; folder: string }[] = [];
    const cancelled = await codeOfAsync(
      importConfirmed(store(), resolved, "details", (req) => {
        asked.push(req);
        return Promise.resolve(false);
      }),
    );
    expect(cancelled).toBe("CANCELLED");
    expect(asked).toEqual([{ name: "report.pdf", folder: realpathSync(outside) }]);
    expect(readdirSync(join(dir, "assets"))).toEqual(["x.bin"]);
    expect(listAssetHashes(db)).toEqual([]);

    const ref = await importConfirmed(store(), resolved, "details", () => Promise.resolve(true));
    expect(isAssetRef(ref.ref)).toBe(true);
    expect(ref.name).toBe("report.pdf");
    expect(existsSync(join(dir, ref.ref))).toBe(true);
    expect(listAssetHashes(db)).toHaveLength(1);
  });

  it("M1 checks the file again after the dialog: a swap for a link into the data folder is refused", async () => {
    const resolved = resolveForImport(dir, { path: join(outside, "report.pdf"), scope: "details" });
    const confirm = () => {
      rmSync(join(outside, "report.pdf"));
      symlinkSync(join(dir, "data.sqlite"), join(outside, "report.pdf"));
      return Promise.resolve(true);
    };
    expect(await codeOfAsync(importConfirmed(store(), resolved, "details", confirm))).toBe("INSIDE_DATA");
    expect(listAssetHashes(db)).toEqual([]);
  });

  it("M1 shows confirmation dialogs one at a time, in order of arrival", async () => {
    const order: string[] = [];
    const slot: { release: (() => void) | null } = { release: null };
    const slow = (req: { name: string; folder: string }) =>
      new Promise<boolean>((resolve) => {
        order.push(`start ${req.name}`);
        slot.release = () => {
          order.push(`end ${req.name}`);
          resolve(true);
        };
      });
    const confirm = serializeConfirm(slow);
    const first = confirm({ name: "a", folder: "/f" });
    const second = confirm({ name: "b", folder: "/f" });
    await Promise.resolve();
    expect(order).toEqual(["start a"]);
    slot.release?.();
    await first;
    await Promise.resolve();
    expect(order).toEqual(["start a", "end a", "start b"]);
    slot.release?.();
    await second;
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
  });
});
