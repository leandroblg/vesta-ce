// T038 (and T058 for logs): reading an export, valid files (research §3; FR-021, FR-023, FR-024).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toExportJson, type ExportData } from "../../../../src/domain/export/format";
import { openExport } from "../../../../src/main/import/reader";
import { makeTask, tempDir } from "../../db/helpers";
import { rawZip, writeZip } from "../../fixtures/zip";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const log = { warn: () => undefined, error: () => undefined, info: () => undefined };

function snapshotDir(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, name.name);
      if (name.isDirectory()) walk(p);
      else out.push(`${p}:${sha(readFileSync(p))}`);
    }
  };
  walk(dir);
  return out.sort();
}

describe("openExport: a valid file", () => {
  let dir: string;
  let dataDir: string;
  let cleanup: () => void;
  const img = Buffer.from("image bytes");
  const H = sha(img);
  const data = (): ExportData => ({
    appVersion: "0.8.0",
    exportedAt: 5,
    tasks: [makeTask({ detailsMd: `![i](assets/${H}.png)` })],
    reminders: [],
    settings: [{ key: "theme", value: "dark", updatedAt: 3 }],
    assets: [{ sha256: H, ext: "png", mimeType: "image/png", size: img.length }],
  });

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    dataDir = join(dir, "data");
    mkdirSync(join(dataDir, "assets"), { recursive: true });
    writeFileSync(join(dataDir, "assets", "existing.bin"), "x");
  });
  afterEach(() => {
    cleanup();
  });

  it("validates data.json and every listed file, writing nothing (FR-021)", async () => {
    const zip = join(dir, "export.zip");
    const d = data();
    await writeZip(zip, { "data.json": toExportJson(d), [`assets/${H}.png`]: img });
    const before = snapshotDir(dataDir);
    const result = await openExport(zip, { log });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.opened.data).toEqual({ ...d, taskEvents: [] });
    expect(result.opened.ignored).toEqual([]);
    result.opened.close();
    expect(snapshotDir(dataDir)).toEqual(before);
  });

  it("ignores logs/ and any other entry, even names that try to leave the folder (FR-023, FR-024)", async () => {
    const zip = join(dir, "export.zip");
    writeFileSync(
      zip,
      rawZip([
        { name: "data.json", data: toExportJson(data()) },
        { name: `assets/${H}.png`, data: img },
        { name: "logs/vesta-001.log", data: "a log line" },
        { name: "../evil.txt", data: "outside" },
        { name: "/etc/passwd-copy", data: "root" },
        { name: `assets/${"f".repeat(64)}.png`, data: "unlisted" },
        { name: "notes.txt", data: "hello" },
      ]),
    );
    const result = await openExport(zip, { log });
    expect(result.ok).toBe(true);
    if (result.ok) result.opened.close();
    expect(existsSync(join(dir, "evil.txt"))).toBe(false);
    expect(existsSync(join(dataDir, "logs"))).toBe(false);
  });

  it("copies the new files into assets/ in the second pass, through a temp file, hashed again", async () => {
    const zip = join(dir, "export.zip");
    await writeZip(zip, { "data.json": toExportJson(data()), [`assets/${H}.png`]: img });
    const result = await openExport(zip, { log });
    if (!result.ok) throw new Error("expected ok");
    await result.opened.copyFiles(dataDir, result.opened.data.assets);
    result.opened.close();
    expect(readFileSync(join(dataDir, "assets", `${H}.png`)).equals(img)).toBe(true);
    expect(readdirSync(join(dataDir, "assets")).filter((n) => n.startsWith(".tmp-"))).toEqual([]);
  });

  it("does not copy a file already stored under the same name", async () => {
    writeFileSync(join(dataDir, "assets", `${H}.png`), img);
    const zip = join(dir, "export.zip");
    await writeZip(zip, { "data.json": toExportJson(data()), [`assets/${H}.png`]: img });
    const result = await openExport(zip, { log });
    if (!result.ok) throw new Error("expected ok");
    await result.opened.copyFiles(dataDir, result.opened.data.assets);
    result.opened.close();
    expect(readFileSync(join(dataDir, "assets", `${H}.png`)).equals(img)).toBe(true);
  });

  it("reports unknown fields as ignored", async () => {
    const zip = join(dir, "export.zip");
    const json = JSON.parse(toExportJson(data())) as { tasks: Record<string, unknown>[] };
    (json.tasks[0] as Record<string, unknown>)["color"] = "red";
    await writeZip(zip, { "data.json": JSON.stringify(json), [`assets/${H}.png`]: img });
    const result = await openExport(zip, { log });
    expect(result.ok && result.opened.ignored).toEqual(["tasks[0].color"]);
    if (result.ok) result.opened.close();
  });
});

describe("010 M2/M4/L10: the reader captures first bytes, marks copies and bounds data.json", () => {
  let dir: string;
  let dataDir: string;
  let cleanup: () => void;
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 9, 9, 9, 9]);
  const H = sha(PNG);
  const data = (): ExportData => ({
    appVersion: "0.8.0",
    exportedAt: 5,
    tasks: [makeTask({ detailsMd: `![i](assets/${H}.png)` })],
    reminders: [],
    settings: [],
    assets: [{ sha256: H, ext: "png", mimeType: "text/html", size: PNG.length }],
  });

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    dataDir = join(dir, "data");
    mkdirSync(join(dataDir, "assets"), { recursive: true });
  });
  afterEach(() => {
    cleanup();
  });

  it("M2 the first 16 bytes of each copied asset are captured, whatever the export declares", async () => {
    const zip = join(dir, "export.zip");
    await writeZip(zip, { "data.json": toExportJson(data()), [`assets/${H}.png`]: PNG });
    const result = await openExport(zip, { log });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = await result.opened.copyFiles(dataDir, result.opened.data.assets);
    expect(Buffer.from(first.get(H) ?? [])).toEqual(PNG.subarray(0, 16));
    expect(readFileSync(join(dataDir, "assets", `${H}.png`))).toEqual(PNG);
    result.opened.close();
  });

  it("M4 every copied asset gets the zone mark once it is in place", async () => {
    const zip = join(dir, "export.zip");
    await writeZip(zip, { "data.json": toExportJson(data()), [`assets/${H}.png`]: PNG });
    const marked: string[] = [];
    const result = await openExport(zip, { log, markDownloaded: (p) => marked.push(p) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.opened.copyFiles(dataDir, result.opened.data.assets);
    expect(marked).toEqual([join(dataDir, "assets", `${H}.png`)]);
    await result.opened.copyFiles(dataDir, result.opened.data.assets); // already present: no second mark
    expect(marked).toHaveLength(1);
    result.opened.close();
  });

  it.skipIf(process.platform === "win32")("L9 import copies are owner-only (FR-023, SC-007)", async () => {
    const zip = join(dir, "export.zip");
    await writeZip(zip, { "data.json": toExportJson(data()), [`assets/${H}.png`]: PNG });
    const result = await openExport(zip, { log });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.opened.copyFiles(dataDir, result.opened.data.assets);
    // The copy enters the data folder like a file stored from the editor: mode 0600, whatever the umask.
    expect(statSync(join(dataDir, "assets", `${H}.png`)).mode & 0o777).toBe(0o600);
    result.opened.close();
  });

  it("L10 a data.json over 64 MiB is damaged before it is read", async () => {
    const zip = join(dir, "export.zip");
    await writeZip(zip, { "data.json": Buffer.alloc(64 * 1024 * 1024 + 1, 0x20) });
    const result = await openExport(zip, { log });
    expect(result).toEqual({ ok: false, refusal: { kind: "damaged", cause: "dataTooLarge", where: "data.json" } });
  }, 30_000);
});
