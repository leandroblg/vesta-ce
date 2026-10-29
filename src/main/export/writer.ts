/**
 * Writing `vesta-export-<date>.zip` (008 research §2; FR-010 to FR-018). The zip is streamed by yazl into a
 * hidden partial file in the chosen folder, then renamed: the final name exists only when the file is complete.
 * Stored files are verified by hash before they are added; `data.json` is added last so its file list is exact.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, fsyncSync, openSync, closeSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import yazl from "yazl";
import { assetRefs } from "../../domain/markdown/assets";
import { assetPath, hashOfRef } from "../../domain/purge";
import { exportFileName } from "../../domain/export/file-name";
import {
  EXPORTED_SETTING_KEYS,
  MAX_DATA_JSON_BYTES,
  toExportJson,
  type ExportAsset,
  type ExportData,
  type ExportSetting,
} from "../../domain/export/format";
import { loadReminders } from "../db/reminders-repo";
import { loadAll } from "../db/tasks-repo";
import { loadAllEvents } from "../db/events-repo";
import { faultActive } from "../faults";
import { errorMessage, type Logger } from "../log";

type Log = Pick<Logger, "warn" | "error" | "info">;

export interface ExportDeps {
  db: Database.Database;
  dataDir: string;
  appVersion: string;
  /** UTC ms: the export time written in `data.json`. */
  now: number;
  log: Log;
  /** Tests lower it; the real limit is MAX_DATA_JSON_BYTES. */
  maxDataJsonBytes?: number;
}

export type ExportResult = { kind: "written"; fileName: string; folder: string; skippedFiles: number } | { kind: "failed" };

interface AssetRow {
  sha256: string;
  ext: string;
  mimeType: string;
  size: number;
}

/** One read transaction: the items, the exported settings, and the stored files the items reference. */
function readSnapshot(db: Database.Database): { items: Omit<ExportData, "appVersion" | "exportedAt" | "assets">; files: AssetRow[]; missing: string[] } {
  return db.transaction(() => {
    const tasks = loadAll(db);
    const reminders = loadReminders(db);
    const placeholders = EXPORTED_SETTING_KEYS.map(() => "?").join(", ");
    const rows = db
      .prepare(`select key, value, updated_at as updatedAt from settings where key in (${placeholders}) order by key`)
      .all(...EXPORTED_SETTING_KEYS) as { key: ExportSetting["key"]; value: string; updatedAt: number }[];
    const settings: ExportSetting[] = rows.map((r) => ({ key: r.key, value: JSON.parse(r.value) as unknown, updatedAt: r.updatedAt }));
    const used = new Set<string>();
    for (const t of tasks) for (const ref of [...assetRefs(t.titleMd), ...assetRefs(t.detailsMd)]) used.add(hashOfRef(ref));
    for (const r of reminders) for (const ref of assetRefs(r.textMd)) used.add(hashOfRef(ref));
    const stored = db.prepare("select sha256, ext, mime_type as mimeType, size from assets order by sha256").all() as AssetRow[];
    const files = stored.filter((a) => used.has(a.sha256));
    const known = new Set(stored.map((a) => a.sha256));
    const missing = [...used].filter((h) => !known.has(h)).sort();
    // 015 FR-023: every task's history, by task, time and recording order (research §6).
    return { items: { tasks, taskEvents: loadAllEvents(db), reminders, settings }, files, missing };
  })();
}

/** The file's content hash, or null when it cannot be read. */
function hashFile(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", () => {
      resolve(null);
    });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
  });
}

function regularLogFiles(dataDir: string): string[] {
  const dir = join(dataDir, "logs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => {
      try {
        return statSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

function fsyncFile(path: string): void {
  const fd = openSync(path, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export async function writeExport(deps: ExportDeps, folder: string, localDate: string, includeLogs: boolean): Promise<ExportResult> {
  const { db, dataDir, log } = deps;
  let partial: string | null = null;
  let out: ReturnType<typeof createWriteStream> | null = null;
  let written: Promise<void> | null = null;
  try {
    const { items, files, missing } = readSnapshot(db);
    let skippedFiles = missing.length;
    for (const sha256 of missing) log.warn("export.file-skipped", { sha256, reason: "not stored" });

    const fileName = exportFileName(localDate, new Set(readdirSync(folder)));
    partial = join(folder, `.${fileName}.partial`);
    const zip = new yazl.ZipFile();
    const stream = createWriteStream(partial, { flags: "wx", mode: 0o600 }); // 010 L9: owner-only
    out = stream;
    written = new Promise<void>((resolve, reject) => {
      stream.on("close", resolve);
      stream.on("error", reject);
      zip.outputStream.on("error", reject);
    });
    // Awaited below; this handler only keeps an early failure from being reported as unhandled.
    written.catch(() => undefined);
    zip.outputStream.pipe(stream);
    const mtime = new Date(deps.now);

    const included: ExportAsset[] = [];
    for (const file of files) {
      const path = join(dataDir, assetPath(file));
      if ((await hashFile(path)) !== file.sha256) {
        skippedFiles += 1;
        log.warn("export.file-skipped", { sha256: file.sha256, reason: existsSync(path) ? "damaged" : "missing" });
        continue;
      }
      zip.addFile(path, assetPath(file), { compress: false, mtime });
      included.push({ sha256: file.sha256, ext: file.ext, mimeType: file.mimeType, size: file.size });
    }
    if (includeLogs) {
      // Read now: the live log grows while the zip is written, and yazl checks sizes (research §2).
      for (const name of regularLogFiles(dataDir)) zip.addBuffer(readFileSync(join(dataDir, "logs", name)), `logs/${name}`, { mtime });
    }
    const json = Buffer.from(toExportJson({ appVersion: deps.appVersion, exportedAt: deps.now, ...items, assets: included }), "utf8");
    if (json.byteLength > (deps.maxDataJsonBytes ?? MAX_DATA_JSON_BYTES)) throw new Error(`data.json is ${String(json.byteLength)} bytes`);
    zip.addBuffer(json, "data.json", { mtime });
    zip.end();
    await written;

    if (faultActive("export-write")) throw new Error("VESTA_FAULT=export-write");
    fsyncFile(partial);
    // The name may have been taken while writing: never overwrite (FR-010).
    const finalName = exportFileName(localDate, new Set(readdirSync(folder)));
    renameSync(partial, join(folder, finalName));
    partial = null;
    log.info("export.written", { files: included.length, skippedFiles, logs: includeLogs });
    return { kind: "written", fileName: finalName, folder, skippedFiles };
  } catch (err) {
    log.error("export.failed", { message: errorMessage(err) });
    // Close the stream first, so its file is not created or written after it is removed.
    if (out !== null && !out.closed) {
      out.destroy();
      await written?.catch(() => undefined);
    }
    if (partial !== null) rmSync(partial, { force: true });
    return { kind: "failed" };
  }
}
