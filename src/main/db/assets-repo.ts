/** Stored files: one row per content hash (005 data-model.md, FR-027, FR-032). */
import { closeSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { assetMimeType } from "../../domain/markdown/assets";
import type Database from "better-sqlite3";

export interface AssetRow {
  sha256: string;
  ext: string;
  mimeType: string;
  size: number;
  createdAt: number;
  /** The "removed from system" tag of FR-032a, or null. */
  removedAt: number | null;
}

interface Row {
  sha256: string;
  ext: string;
  mime_type: string;
  size: number;
  created_at: number;
  removed_at: number | null;
}

const toAsset = (r: Row): AssetRow => ({
  sha256: r.sha256,
  ext: r.ext,
  mimeType: r.mime_type,
  size: r.size,
  createdAt: r.created_at,
  removedAt: r.removed_at,
});

/**
 * Inserts the row unless the hash is already stored; an existing row is kept, and loses its removed tag
 * because the file is referenced again (FR-032a). Returns true when a new row was written.
 */
export function insertAsset(db: Database.Database, asset: AssetRow): boolean {
  return db.transaction(() => {
    const inserted = db
      .prepare(
        "insert or ignore into assets (sha256, ext, mime_type, size, created_at, removed_at) values (?, ?, ?, ?, ?, null)",
      )
      .run(asset.sha256, asset.ext, asset.mimeType, asset.size, asset.createdAt);
    if (inserted.changes === 0) db.prepare("update assets set removed_at = null where sha256 = ?").run(asset.sha256);
    return inserted.changes > 0;
  })();
}

export function getAsset(db: Database.Database, sha256: string): AssetRow | null {
  const row = db.prepare("select * from assets where sha256 = ?").get(sha256) as Row | undefined;
  return row === undefined ? null : toAsset(row);
}

export function listAssetHashes(db: Database.Database): string[] {
  return (db.prepare("select sha256 from assets").all() as { sha256: string }[]).map((r) => r.sha256);
}

export function deleteAssets(db: Database.Database, hashes: readonly string[]): void {
  if (hashes.length === 0) return;
  const remove = db.prepare("delete from assets where sha256 = ?");
  db.transaction(() => {
    for (const h of hashes) remove.run(h);
  })();
}

export function listAssets(db: Database.Database): { sha256: string; ext: string }[] {
  return db.prepare("select sha256, ext from assets").all() as { sha256: string; ext: string }[];
}

/**
 * 010 FR-004 (M2): once after the upgrade, every stored file's type is recomputed from its first bytes and extension,
 * so no type that came from an earlier import remains. A missing file keeps the extension's type.
 */
export function recomputeAssetTypes(db: Database.Database, dir: string): { count: number; changed: number } {
  const rows = db.prepare("select sha256, ext, mime_type as mimeType from assets").all() as { sha256: string; ext: string; mimeType: string }[];
  const update = db.prepare("update assets set mime_type = ? where sha256 = ?");
  let changed = 0;
  db.transaction(() => {
    for (const row of rows) {
      const file = join(dir, "assets", row.ext === "" ? row.sha256 : `${row.sha256}.${row.ext}`);
      const type = assetMimeType(firstBytesOf(file), row.ext);
      if (type === row.mimeType) continue;
      update.run(type, row.sha256);
      changed += 1;
    }
  })();
  return { count: rows.length, changed };
}

function firstBytesOf(path: string): Uint8Array {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(16);
    const n = readSync(fd, buf, 0, 16, 0);
    return new Uint8Array(buf.subarray(0, n));
  } catch {
    return new Uint8Array(0);
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
