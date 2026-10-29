// Stored files (FR-027 to FR-029, data-model.md): named by content hash, written to a temp file and renamed
// into place before the row is committed, so a row never exists without its file.
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import type { Clock } from "../../domain/clock";
import { assetMimeType, sniffImage, storedExtension } from "../../domain/markdown/assets";
import type { AssetRef, AssetScope } from "../../shared/ipc-contract";
import { insertAsset } from "../db/assets-repo";
import { faultActive } from "../faults";

export const MAX_ASSET_BYTES = 104_857_600;

export class AssetError extends Error {
  constructor(
    readonly code: "TOO_LARGE" | "NOT_IMAGE" | "NOT_FOUND" | "INSIDE_DATA" | "CANCELLED",
    message: string,
  ) {
    super(message);
    this.name = "AssetError";
  }
}

export interface AssetStore {
  /** The data folder; files go to `<dir>/assets`. */
  dir: string;
  db: Database.Database;
  clock: Clock;
  /** 010 M4: the Windows zone mark needs the platform; defaults to this process. */
  platform?: NodeJS.Platform;
  log?: { warn: (event: string, fields: Record<string, unknown>) => void };
}

const ZONE_IDENTIFIER = "[ZoneTransfer]\r\nZoneId=3\r\n";
let zoneMarkFailureLogged = false;

/**
 * 010 FR-007 (M4): on Windows, every file Vesta stores carries the Zone.Identifier mark (zone 3, Internet) so the
 * OS applies its download protections when the user opens it later. A failure is logged once and never fails the
 * insertion (a volume without alternate data streams, for example).
 */
export function markDownloaded(
  path: string,
  platform: NodeJS.Platform,
  log?: { warn: (event: string, fields: Record<string, unknown>) => void },
  writeFile: (file: string, content: string) => void = (file, content) => {
    writeFileSync(file, content);
  },
): void {
  if (platform !== "win32") return;
  try {
    writeFile(`${path}:Zone.Identifier`, ZONE_IDENTIFIER);
  } catch (err) {
    if (zoneMarkFailureLogged) return;
    zoneMarkFailureLogged = true;
    log?.warn("asset.zone-mark-failed", { message: err instanceof Error ? err.message : String(err) });
  }
}

/** Tests only: lets the once-per-process log be exercised again. */
export function resetZoneMarkLog(): void {
  zoneMarkFailureLogged = false;
}

export function importBytes(
  store: AssetStore,
  input: { name: string; bytes: Uint8Array; scope: AssetScope },
): AssetRef {
  const { name, bytes, scope } = input;
  if (bytes.byteLength > MAX_ASSET_BYTES) throw new AssetError("TOO_LARGE", `${name} is larger than 100 MB`);
  const image = sniffImage(bytes.subarray(0, 16));
  if (scope === "title" && image === null) throw new AssetError("NOT_IMAGE", `${name} is not an image`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ext = storedExtension(name);
  const file = ext === "" ? sha256 : `${sha256}.${ext}`;
  const folder = join(store.dir, "assets");
  mkdirSync(folder, { recursive: true });
  const target = join(folder, file);
  if (!existsSync(target)) {
    writeAtomically(folder, target, bytes);
    markDownloaded(target, store.platform ?? process.platform, store.log);
  }
  insertAsset(store.db, {
    sha256,
    ext,
    mimeType: assetMimeType(bytes.subarray(0, 16), ext),
    size: bytes.byteLength,
    createdAt: store.clock.now(),
    removedAt: null,
  });
  return { ref: `assets/${file}`, name, isImage: image !== null };
}

/** True when `path` is `root` or under it (both already real paths). */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** What the confirmation dialog shows and what main reads after Add (010 M1, research §3). */
export interface ResolvedImport {
  /** The real path, symbolic links and aliases resolved. */
  path: string;
  name: string;
  folder: string;
  size: number;
}

export interface ConfirmRequest {
  name: string;
  folder: string;
}

export type ConfirmImport = (request: ConfirmRequest) => Promise<boolean>;

function realPathOf(input: string): string {
  const path = /^file:/i.test(input) ? fileURLToPath(input) : input;
  try {
    return realpathSync(path);
  } catch {
    throw new AssetError("NOT_FOUND", `${basename(path)} was not found`);
  }
}

/**
 * 010 FR-001, FR-002 (M1): the checks that run before any dialog, in this order: the real path exists and is a
 * regular file, it is not inside the data folder, it is not over 100 MB. Nothing is read.
 */
export function resolveForImport(dataDir: string, input: { path: string; scope: AssetScope }): ResolvedImport {
  const path = realPathOf(input.path);
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new AssetError("NOT_FOUND", `${basename(path)} is not a file`);
    size = stat.size;
  } catch (err) {
    if (err instanceof AssetError) throw err;
    throw new AssetError("NOT_FOUND", `${basename(path)} was not found`);
  }
  let dataReal: string;
  try {
    dataReal = realpathSync(dataDir);
  } catch {
    dataReal = dataDir;
  }
  if (isInside(dataReal, path)) throw new AssetError("INSIDE_DATA", `${basename(path)} is inside the data folder`);
  if (size > MAX_ASSET_BYTES) throw new AssetError("TOO_LARGE", `${basename(path)} is larger than 100 MB`);
  return { path, name: basename(path), folder: dirname(path), size };
}

/**
 * Asks, then reads (010 FR-001): Cancel stores nothing; Add runs the three checks again on the resolved path, so a
 * file swapped between the dialog and the copy is refused, and stores the copy under the name the dialog showed.
 */
export async function importConfirmed(store: AssetStore, resolved: ResolvedImport, scope: AssetScope, confirm: ConfirmImport): Promise<AssetRef> {
  const ok = await confirm({ name: resolved.name, folder: resolved.folder });
  if (!ok) throw new AssetError("CANCELLED", `${resolved.name} was not added`);
  const again = resolveForImport(store.dir, { path: resolved.path, scope });
  return importBytes(store, { name: resolved.name, bytes: readFileSync(again.path), scope });
}

/** Dialogs one at a time, in order of arrival (010 FR-003). */
export function serializeConfirm(confirm: ConfirmImport): ConfirmImport {
  let chain: Promise<unknown> = Promise.resolve();
  return (request) => {
    const next = chain.then(
      () => confirm(request),
      () => confirm(request),
    );
    chain = next;
    return next;
  };
}

/** FR-027a (the picker, 005): a regular file by absolute path or `file:` URL; the user chose it, so no dialog. */
export function importPath(store: AssetStore, input: { path: string; scope: AssetScope }): AssetRef {
  const path = /^file:/i.test(input.path) ? fileURLToPath(input.path) : input.path;
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new AssetError("NOT_FOUND", `${path} is not a file`);
    size = stat.size;
  } catch (err) {
    if (err instanceof AssetError) throw err;
    throw new AssetError("NOT_FOUND", `${path} was not found`);
  }
  if (size > MAX_ASSET_BYTES) throw new AssetError("TOO_LARGE", `${basename(path)} is larger than 100 MB`);
  return importBytes(store, { name: basename(path), bytes: readFileSync(path), scope: input.scope });
}

function writeAtomically(folder: string, target: string, bytes: Uint8Array): void {
  const temp = join(folder, `.tmp-${randomBytes(8).toString("hex")}`);
  try {
    const fd = openSync(temp, "w", 0o600); // 010 L9: owner-only
    try {
      writeSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (faultActive("asset-write")) throw new Error("VESTA_FAULT=asset-write");
    renameSync(temp, target);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
