import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { deleteAssets, getAsset, insertAsset, listAssetHashes, recomputeAssetTypes, type AssetRow } from "../../../src/main/db/assets-repo";
import { mkdirSync, writeFileSync } from "node:fs";
import { tempDir } from "./helpers";

const A = "a".repeat(64);
const B = "b".repeat(64);
const row = (sha256: string, overrides: Partial<AssetRow> = {}): AssetRow => ({
  sha256,
  ext: "png",
  mimeType: "image/png",
  size: 10,
  createdAt: 100,
  removedAt: null,
  ...overrides,
});

describe("assets repository (005 data-model.md)", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  it("inserts a row and reads it back", () => {
    expect(insertAsset(db, row(A))).toBe(true);
    expect(getAsset(db, A)).toEqual(row(A));
    expect(getAsset(db, B)).toBeNull();
  });

  it("keeps the first row when the same hash is inserted again (stored once)", () => {
    insertAsset(db, row(A, { ext: "png", createdAt: 100 }));
    expect(insertAsset(db, row(A, { ext: "jpg", createdAt: 200 }))).toBe(false);
    expect(getAsset(db, A)).toEqual(row(A, { ext: "png", createdAt: 100 }));
  });

  it("clears the removed tag when a tagged file is inserted again (FR-032a)", () => {
    insertAsset(db, row(A));
    db.prepare("update assets set removed_at = 500 where sha256 = ?").run(A);
    insertAsset(db, row(A, { createdAt: 900 }));
    expect(getAsset(db, A)).toEqual(row(A, { removedAt: null }));
  });

  it("lists every hash and deletes the given ones", () => {
    insertAsset(db, row(A));
    insertAsset(db, row(B, { ext: "", mimeType: "application/octet-stream" }));
    expect(listAssetHashes(db).sort()).toEqual([A, B]);
    deleteAssets(db, [A]);
    expect(listAssetHashes(db)).toEqual([B]);
    deleteAssets(db, []);
    expect(listAssetHashes(db)).toEqual([B]);
  });
});

describe("M2 recomputeAssetTypes (010 FR-004, research §4)", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    mkdirSync(join(dir, "assets"));
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  it("M2 rewrites every stored type from the file's bytes and extension, once", () => {
    insertAsset(db, row(A, { ext: "png", mimeType: "text/html" }));
    writeFileSync(join(dir, "assets", `${A}.png`), PNG);
    insertAsset(db, row(B, { ext: "pdf", mimeType: "image/png" }));
    writeFileSync(join(dir, "assets", `${B}.pdf`), "%PDF-1.7 content");
    const C = "c".repeat(64);
    insertAsset(db, row(C, { ext: "txt", mimeType: "application/x-sh" })); // file missing: the extension decides
    const D = "d".repeat(64);
    insertAsset(db, row(D, { ext: "jpg", mimeType: "image/png" }));
    writeFileSync(join(dir, "assets", `${D}.jpg`), PNG); // a PNG named .jpg keeps image/png
    expect(recomputeAssetTypes(db, dir)).toEqual({ count: 4, changed: 3 });
    expect(getAsset(db, A)?.mimeType).toBe("image/png");
    expect(getAsset(db, B)?.mimeType).toBe("application/pdf");
    expect(getAsset(db, C)?.mimeType).toBe("text/plain");
    expect(getAsset(db, D)?.mimeType).toBe("image/png");
    expect(recomputeAssetTypes(db, dir)).toEqual({ count: 4, changed: 0 });
  });
});
