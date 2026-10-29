// T033 (and T058 for logs): the export writer with real yazl and yauzl (research §2; FR-010 to FR-018, FR-015).
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseExport } from "../../../../src/domain/export/parse";
import { insertAsset } from "../../../../src/main/db/assets-repo";
import { openDatabase } from "../../../../src/main/db/connection";
import { migrate } from "../../../../src/main/db/migrate";
import { applyReminderChangeSet } from "../../../../src/main/db/reminders-repo";
import { applyChangeSet } from "../../../../src/main/db/tasks-repo";
import { writeExport } from "../../../../src/main/export/writer";
import { initFaults } from "../../../../src/main/faults";
import { makeReminder, makeTask, tempDir } from "../../db/helpers";
import { readZip } from "../../fixtures/zip";

const log = { warn: () => undefined, error: () => undefined, info: () => undefined };
const sha = (data: string) => createHash("sha256").update(data).digest("hex");

describe("writeExport", () => {
  let dir: string;
  let out: string;
  let cleanup: () => void;
  let db: Database.Database;
  const deps = () => ({ db, dataDir: dir, appVersion: "0.8.0", now: 1_792_400_000_000, log });

  function store(content: string, ext: string): string {
    const h = sha(content);
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets", ext === "" ? h : `${h}.${ext}`), content);
    insertAsset(db, { sha256: h, ext, mimeType: ext === "png" ? "image/png" : "application/pdf", size: content.length, createdAt: 1, removedAt: null });
    return h;
  }

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    out = join(dir, "out");
    mkdirSync(out);
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    db.close();
    chmodSync(out, 0o755);
    cleanup();
    delete process.env["VESTA_FAULT"];
    initFaults(true);
  });

  it("writes data.json and each referenced file once, byte for byte and stored uncompressed (FR-012, FR-013)", async () => {
    const img = store("image-bytes", "png");
    const pdf = store("pdf-bytes", "pdf");
    const trashImg = store("trash-image", "png");
    const unused = store("never-referenced", "png");
    applyChangeSet(db, {
      upserts: [
        makeTask({ titleMd: `![i](assets/${img}.png)`, detailsMd: `![i](assets/${img}.png) [p](assets/${pdf}.pdf)` }),
        makeTask({ detailsMd: `![t](assets/${trashImg}.png)`, deletedAt: 5 }),
      ],
      removals: [],
    });
    applyReminderChangeSet(db, { upserts: [makeReminder({ textMd: `![i](assets/${img}.png)` })], removals: [], sectionCollapsed: true }, 9);
    const result = await writeExport(deps(), out, "2026-10-19", false);
    expect(result).toEqual({ kind: "written", fileName: "vesta-export-2026-10-19.zip", folder: out, skippedFiles: 0 });
    const zip = await readZip(join(out, "vesta-export-2026-10-19.zip"));
    expect([...zip.keys()].sort()).toEqual([`assets/${img}.png`, `assets/${pdf}.pdf`, `assets/${trashImg}.png`, "data.json"].sort());
    expect(zip.get(`assets/${img}.png`)?.data.toString()).toBe("image-bytes");
    expect(zip.get(`assets/${img}.png`)?.compressed).toBe(false);
    expect(zip.get("data.json")?.compressed).toBe(true);
    const parsed = parseExport(zip.get("data.json")?.data.toString("utf8") ?? "");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.tasks).toHaveLength(2);
    expect(parsed.data.reminders).toHaveLength(1);
    expect(parsed.data.assets.map((a) => a.sha256).sort()).toEqual([img, pdf, trashImg].sort());
    expect(parsed.data.assets.some((a) => a.sha256 === unused)).toBe(false);
    expect(parsed.data.settings.find((s) => s.key === "remindersCollapsed")).toEqual({ key: "remindersCollapsed", value: true, updatedAt: 9 });
    expect(parsed.data.exportedAt).toBe(1_792_400_000_000);
    expect(parsed.data.appVersion).toBe("0.8.0");
  });

  it("exports only the allow-listed settings, never machine state (FR-016)", async () => {
    db.prepare("insert into settings (key, value, updated_at) values ('somethingLocal', '1', 3)").run();
    db.prepare("insert into backup_assets (backup, path) values ('backups/latest.sqlite', ?)").run(`assets/${"c".repeat(64)}.png`);
    await writeExport(deps(), out, "2026-10-19", false);
    const json = (await readZip(join(out, "vesta-export-2026-10-19.zip"))).get("data.json")?.data.toString() ?? "";
    expect(json).not.toContain("somethingLocal");
    expect(json).not.toContain("backups/");
    expect(Object.keys(JSON.parse(json) as object)).toEqual(["format", "formatVersion", "appVersion", "exportedAt", "tasks", "taskEvents", "reminders", "settings", "assets"]);
  });

  it("leaves out, counts and logs a missing or damaged file, and finishes (FR-014, Q118)", async () => {
    const gone = store("gone", "png");
    const damaged = store("original", "png");
    rmSync(join(dir, "assets", `${gone}.png`));
    writeFileSync(join(dir, "assets", `${damaged}.png`), "tampered");
    const neverStored = sha("never stored");
    applyChangeSet(db, { upserts: [makeTask({ detailsMd: `![a](assets/${gone}.png) ![b](assets/${damaged}.png) ![c](assets/${neverStored}.png)` })], removals: [] });
    const warned: unknown[] = [];
    const result = await writeExport({ ...deps(), log: { ...log, warn: (e: string, f?: unknown) => warned.push([e, f]) } }, out, "2026-10-19", false);
    expect(result).toMatchObject({ kind: "written", skippedFiles: 3 });
    const zip = await readZip(join(out, "vesta-export-2026-10-19.zip"));
    expect([...zip.keys()]).toEqual(["data.json"]);
    const parsed = parseExport(zip.get("data.json")?.data.toString() ?? "");
    expect(parsed.ok && parsed.data.assets).toEqual([]);
    expect(warned).toHaveLength(3);
  });

  it("finds a file referenced under another extension by its hash (research §9)", async () => {
    const h = store("jpeg-bytes", "jpeg");
    applyChangeSet(db, { upserts: [makeTask({ detailsMd: `![a](assets/${h}.jpg)` })], removals: [] });
    const result = await writeExport(deps(), out, "2026-10-19", false);
    expect(result).toMatchObject({ skippedFiles: 0 });
    expect([...(await readZip(join(out, "vesta-export-2026-10-19.zip"))).keys()]).toContain(`assets/${h}.jpeg`);
  });

  it("never overwrites: the name gets -2, -3 (FR-010)", async () => {
    writeFileSync(join(out, "vesta-export-2026-10-19.zip"), "keep me");
    expect(await writeExport(deps(), out, "2026-10-19", false)).toMatchObject({ fileName: "vesta-export-2026-10-19-2.zip" });
    expect(await writeExport(deps(), out, "2026-10-19", false)).toMatchObject({ fileName: "vesta-export-2026-10-19-3.zip" });
    expect(existsSync(join(out, "vesta-export-2026-10-19.zip"))).toBe(true);
  });

  it("fails cleanly with VESTA_FAULT=export-write: no zip and no partial file (FR-017)", async () => {
    initFaults(false);
    process.env["VESTA_FAULT"] = "export-write";
    expect(await writeExport(deps(), out, "2026-10-19", false)).toEqual({ kind: "failed" });
    expect(readdirSync(out)).toEqual([]);
  });

  it("fails cleanly in a folder it cannot write (FR-017)", async () => {
    chmodSync(out, 0o555);
    expect(await writeExport(deps(), out, "2026-10-19", false)).toEqual({ kind: "failed" });
    chmodSync(out, 0o755);
    expect(readdirSync(out)).toEqual([]);
  });

  it("fails cleanly when data.json would exceed the limit", async () => {
    applyChangeSet(db, { upserts: [makeTask({ detailsMd: "x".repeat(5000) })], removals: [] });
    expect(await writeExport({ ...deps(), maxDataJsonBytes: 1000 }, out, "2026-10-19", false)).toEqual({ kind: "failed" });
    expect(readdirSync(out)).toEqual([]);
  });

  it("adds logs/ with a copy of every log file only when asked (FR-015, SC-008)", async () => {
    mkdirSync(join(dir, "logs"));
    writeFileSync(join(dir, "logs", "vesta-001.log"), "line one\n");
    writeFileSync(join(dir, "logs", "vesta-002.log"), "line two\n");
    mkdirSync(join(dir, "logs", "not-a-file"));
    await writeExport(deps(), out, "2026-10-19", false);
    expect([...(await readZip(join(out, "vesta-export-2026-10-19.zip"))).keys()].some((k) => k.startsWith("logs/"))).toBe(false);
    await writeExport(deps(), out, "2026-10-19", true);
    const zip = await readZip(join(out, "vesta-export-2026-10-19-2.zip"));
    expect(zip.get("logs/vesta-001.log")?.data.toString()).toBe("line one\n");
    expect(zip.get("logs/vesta-002.log")?.data.toString()).toBe("line two\n");
    expect(zip.get("logs/vesta-001.log")?.compressed).toBe(true);
    expect([...zip.keys()].filter((k) => k.startsWith("logs/"))).toHaveLength(2);
  });
});
