/**
 * Reading an export (008 research §3; FR-021 to FR-024). Two phases, and nothing is written until both pass:
 * A reads the entry names and `data.json`; B streams each listed file through SHA-256. Entry names are only
 * classified (entries.ts), never used as paths: files are written to paths built from the validated hash and
 * extension, after the pre-import backup, by `copyFiles`.
 */
import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync,
  readSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import yauzl from "yauzl";
import { classifyEntry } from "../../domain/export/entries";
import { MAX_DATA_JSON_BYTES, type ExportAsset, type ExportData } from "../../domain/export/format";
import { markDownloaded } from "../assets/store";
import { parseExport, type DamageCause, type Refusal } from "../../domain/export/parse";
import { assetPath } from "../../domain/purge";
import type { Logger } from "../log";

type Log = Pick<Logger, "warn" | "error" | "info">;

export interface OpenedExport {
  data: ExportData;
  /** Unknown fields and settings that were dropped (FR-012a), for the log. */
  ignored: string[];
  /**
   * Copies `files` from the zip into `<dataDir>/assets`, hashing each again; skips names already stored. Returns
   * the first 16 bytes of each file by hash, so the stored type comes from the bytes, never from the export (010 M2).
   */
  copyFiles(dataDir: string, files: readonly ExportAsset[]): Promise<Map<string, Uint8Array>>;
  close(): void;
}

export type OpenResult = { ok: true; opened: OpenedExport } | { ok: false; refusal: Refusal };

class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.kind);
  }
}

const damaged = (cause: DamageCause, where: string): Refused => new Refused({ kind: "damaged", cause, where });

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    // decodeStrings: false gives raw names, so a hostile name is ignored here rather than failing the file.
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: true, strictFileNames: false }, (err, zip) => {
      if (err !== null) reject(err);
      else resolve(zip);
    });
  });
}

function listEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    zip.on("entry", (entry: yauzl.Entry) => {
      entries.push(entry);
      zip.readEntry();
    });
    zip.once("end", () => {
      resolve(entries);
    });
    zip.once("error", reject);
    zip.readEntry();
  });
}

function openStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err !== null) reject(err);
      else resolve(stream);
    });
  });
}

function nameOf(entry: yauzl.Entry): string {
  const raw = entry.fileName as unknown as Buffer | string;
  return typeof raw === "string" ? raw : raw.toString("utf8");
}

async function readAll(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  const stream = await openStream(zip, entry);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Streams an entry through SHA-256; with `writeTo`, also into that file descriptor. Returns hash and bytes. */
async function hashEntry(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
  writeTo?: number,
): Promise<{ hash: string; bytes: number; first16: Uint8Array }> {
  const stream = await openStream(zip, entry);
  const hash = createHash("sha256");
  let bytes = 0;
  let first16 = Buffer.alloc(0);
  for await (const chunk of stream) {
    const buf = chunk as Buffer;
    hash.update(buf);
    bytes += buf.length;
    if (first16.length < 16) first16 = Buffer.concat([first16, buf]).subarray(0, 16);
    if (writeTo !== undefined) writeSync(writeTo, buf);
  }
  return { hash: hash.digest("hex"), bytes, first16: new Uint8Array(first16) };
}

/** The first 16 bytes of a file already on disk (a copy skipped because it was there). */
function readFirst16(path: string): Uint8Array {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(16);
    const n = readSync(fd, buf, 0, 16, 0);
    return new Uint8Array(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
}

export async function openExport(
  path: string,
  options: { log: Log; maxDataJsonBytes?: number; markDownloaded?: (path: string) => void },
): Promise<OpenResult> {
  // 010 M4 (FR-007): copies get the Windows zone mark like files stored from the editor.
  const mark =
    options.markDownloaded ??
    ((p: string) => {
      markDownloaded(p, process.platform, options.log);
    });
  let zip: yauzl.ZipFile;
  try {
    zip = await openZip(path);
  } catch (err) {
    // FR-022: every refusal is logged, a file that is not even a zip included.
    options.log.warn("import.refused", { kind: "notVesta", reason: err instanceof Error ? err.message : String(err) });
    return { ok: false, refusal: { kind: "notVesta" } };
  }
  try {
    // Phase A: names and data.json.
    let entries: yauzl.Entry[];
    try {
      entries = await listEntries(zip);
    } catch {
      throw new Refused({ kind: "notVesta" });
    }
    let dataEntry: yauzl.Entry | null = null;
    const assets = new Map<string, yauzl.Entry>();
    for (const entry of entries) {
      const name = nameOf(entry);
      const kind = classifyEntry(name);
      if (kind.kind === "data") {
        if (dataEntry !== null) throw damaged("invalidField", "data.json");
        dataEntry = entry;
      } else if (kind.kind === "asset") {
        if (assets.has(name)) throw damaged("invalidField", name);
        assets.set(name, entry);
      }
    }
    if (dataEntry === null) throw new Refused({ kind: "notVesta" });
    if (dataEntry.uncompressedSize > (options.maxDataJsonBytes ?? MAX_DATA_JSON_BYTES)) throw damaged("dataTooLarge", "data.json");
    let text: string;
    try {
      text = (await readAll(zip, dataEntry)).toString("utf8");
    } catch {
      throw damaged("invalidField", "data.json");
    }
    const parsed = parseExport(text);
    if (!parsed.ok) throw new Refused(parsed.refusal);

    // Phase B: each listed file, hashed, nothing written.
    const listed = new Map<string, yauzl.Entry>();
    for (const asset of parsed.data.assets) {
      const name = assetPath(asset);
      const entry = assets.get(name);
      if (entry === undefined) throw damaged("missingFile", name);
      if (entry.uncompressedSize !== asset.size) throw damaged("sizeMismatch", name);
      let result: { hash: string; bytes: number };
      try {
        result = await hashEntry(zip, entry);
      } catch {
        throw damaged("checksum", name);
      }
      if (result.bytes !== asset.size) throw damaged("sizeMismatch", name);
      if (result.hash !== asset.sha256) throw damaged("checksum", name);
      listed.set(asset.sha256, entry);
    }
    for (const field of parsed.ignored) options.log.warn("import.ignored", { field });

    const opened: OpenedExport = {
      data: parsed.data,
      ignored: parsed.ignored,
      async copyFiles(dataDir, files) {
        const folder = join(dataDir, "assets");
        mkdirSync(folder, { recursive: true });
        const firstBytes = new Map<string, Uint8Array>();
        for (const file of files) {
          const target = join(dataDir, assetPath(file));
          if (existsSync(target)) {
            firstBytes.set(file.sha256, readFirst16(target));
            continue;
          }
          const entry = listed.get(file.sha256);
          if (entry === undefined) throw new Error(`${file.sha256} was not validated`);
          const temp = join(folder, `.tmp-${randomBytes(8).toString("hex")}`);
          const fd = openSync(temp, "w", 0o600); // 010 L9 (FR-023): a copy enters the data folder owner-only, like every stored file
          try {
            const { hash, first16 } = await hashEntry(zip, entry, fd);
            fsyncSync(fd);
            closeSync(fd);
            if (hash !== file.sha256) throw new Error(`${assetPath(file)} changed since it was checked`);
            renameSync(temp, target);
            mark(target);
            firstBytes.set(file.sha256, first16);
          } finally {
            try {
              closeSync(fd);
            } catch {
              // already closed
            }
            if (existsSync(temp)) unlinkSync(temp);
          }
        }
        return firstBytes;
      },
      close() {
        zip.close();
      },
    };
    return { ok: true, opened };
  } catch (err) {
    zip.close();
    if (err instanceof Refused) {
      options.log.warn("import.refused", { ...err.refusal });
      return { ok: false, refusal: err.refusal };
    }
    throw err;
  }
}
