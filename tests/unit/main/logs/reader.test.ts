import { chmodSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LogLevel } from "../../../../src/domain/logs/levels";
import { readLogPage } from "../../../../src/main/logs/reader";
import type { LogCursor, LogLine } from "../../../../src/shared/ipc-contract";

let base: string;
let dir: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "vesta-reader-"));
  dir = join(base, "logs");
  mkdirSync(dir);
});

afterEach(() => {
  try {
    chmodSync(dir, 0o755);
  } catch {
    // removed
  }
  rmSync(base, { recursive: true, force: true });
});

const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);
const line = (seq: number, level: string, extra = "") =>
  `${JSON.stringify({ time: new Date(T0 + seq * 1000).toISOString(), level, event: "seed", seq, pad: extra })}\n`;

/** Writes files in order (oldest first); entry levels cycle through `levels`. Returns entries in write order. */
function seed(numbers: number[], perFile: number, levels: string[] = ["info"], pad = ""): { seq: number; level: string }[] {
  const all: { seq: number; level: string }[] = [];
  let seq = 0;
  for (const n of numbers) {
    let text = "";
    for (let i = 0; i < perFile; i++) {
      const level = levels[seq % levels.length] ?? "info";
      text += line(seq, level, pad);
      all.push({ seq, level });
      seq++;
    }
    writeFileSync(join(dir, `vesta-${String(n).padStart(3, "0")}.log`), text);
  }
  return all;
}

/** Follows the cursors to the end; returns every line, newest first. */
async function readAll(level: LogLevel, options: Parameters<typeof readLogPage>[3] = {}): Promise<{ lines: LogLine[]; pages: number }> {
  const lines: LogLine[] = [];
  let cursor: LogCursor | null = null;
  let pages = 0;
  for (;;) {
    const page = await readLogPage(dir, cursor, level, options);
    lines.push(...page.lines);
    pages++;
    if (page.older === null) return { lines, pages };
    cursor = page.older;
    if (pages > 10_000) throw new Error("no end");
  }
}

const seqs = (lines: LogLine[]) => lines.map((l) => l.fields["seq"]);

describe("readLogPage (009 FR-014, FR-019, research §6; newest first, PRD Q127)", () => {
  it("gives the newest entries first, at most 400 per page, and every entry once across files", async () => {
    const all = seed([1, 2, 3], 300);
    const first = await readLogPage(dir, null, "info");
    expect(first.lines).toHaveLength(400);
    expect(first.lines[0]?.fields["seq"]).toBe(899);
    expect(first.older).not.toBeNull();
    const { lines } = await readAll("info");
    expect(seqs(lines)).toEqual(all.map((e) => e.seq).reverse());
    expect(lines[0]).toMatchObject({ level: "info", event: "seed", time: T0 + 899_000, raw: null, cut: false });
  });

  it("follows the circular order across the 999 → 001 wrap", async () => {
    const all = seed([998, 999, 1, 2], 50);
    expect(seqs((await readAll("info")).lines)).toEqual(all.map((e) => e.seq).reverse());
  });

  it("keeps a line whole when a chunk boundary falls inside it, multi-byte text included", async () => {
    const all = seed([1], 40, ["info"], "é😀".repeat(20));
    const { lines } = await readAll("info", { chunkBytes: 64 });
    expect(seqs(lines)).toEqual(all.map((e) => e.seq).reverse());
    expect(lines.every((l) => l.fields["pad"] === "é😀".repeat(20))).toBe(true);
  });

  it("filters by level, legacy warn included, and shows unreadable lines at every level", async () => {
    writeFileSync(
      join(dir, "vesta-001.log"),
      `${line(0, "info")}${line(1, "warn")}not json at all\n${line(3, "error")}${line(4, "debug")}{"time":"2026-10-19T12:00:05.000Z","level":"fa`,
    );
    const at = async (level: LogLevel) => (await readAll(level)).lines.map((l) => l.raw ?? `${String(l.level)}:${String(l.fields["seq"])}`);
    expect(await at("error")).toEqual(['{"time":"2026-10-19T12:00:05.000Z","level":"fa', "error:3", "not json at all"]);
    expect(await at("warn")).toEqual(['{"time":"2026-10-19T12:00:05.000Z","level":"fa', "error:3", "not json at all", "warn:1"]);
    expect(await at("trace")).toEqual(['{"time":"2026-10-19T12:00:05.000Z","level":"fa', "debug:4", "error:3", "not json at all", "warn:1", "info:0"]);
  });

  it("never scans more than the limit in one call, returning fewer lines with a cursor until the oldest entry", async () => {
    const all = seed([1, 2, 3, 4], 2000, ["info", "info", "info", "info", "info", "info", "info", "info", "info", "fatal"]);
    const { lines, pages } = await readAll("fatal", { scanBytes: 64 * 1024 });
    expect(seqs(lines)).toEqual(all.filter((e) => e.level === "fatal").map((e) => e.seq).reverse());
    expect(pages).toBeGreaterThan(4);
  });

  it("stops with removedOlder when rotation deleted the file being read (FR-019)", async () => {
    seed([1, 2], 500);
    const first = await readLogPage(dir, null, "info");
    expect(first.older?.file).toBe("vesta-002.log");
    const second = await readLogPage(dir, first.older, "info");
    expect(second.older?.file).toBe("vesta-001.log");
    unlinkSync(join(dir, "vesta-001.log"));
    expect(await readLogPage(dir, second.older, "info")).toEqual({ lines: [], older: null, removedOlder: true, unreadable: false });
  });

  it("an empty or missing folder gives no lines; an unreadable one says so (FR-019)", async () => {
    expect(await readLogPage(dir, null, "info")).toEqual({ lines: [], older: null, removedOlder: false, unreadable: false });
    expect(await readLogPage(join(base, "nope"), null, "info")).toEqual({ lines: [], older: null, removedOlder: false, unreadable: false });
    if (process.getuid?.() === 0) return;
    seed([1], 3);
    chmodSync(dir, 0o000);
    expect(await readLogPage(dir, null, "info")).toMatchObject({ lines: [], older: null, unreadable: true });
  });

  it("opens 50 MiB of logs fast, and a level switch is fast too (SC-003, SC-004)", async () => {
    seed(Array.from({ length: 50 }, (_, i) => i + 1), 1000, ["info", "info", "warn", "debug", "error"], "x".repeat(900));
    let t = performance.now();
    const first = await readLogPage(dir, null, "info");
    const firstMs = performance.now() - t;
    t = performance.now();
    await readLogPage(dir, null, "error");
    const switchMs = performance.now() - t;
    expect(first.lines).toHaveLength(400);
    expect(firstMs).toBeLessThan(300);
    expect(switchMs).toBeLessThan(300);
    console.log(`reader: first page ${firstMs.toFixed(1)} ms, level switch ${switchMs.toFixed(1)} ms`);
  }, 60_000);
});
