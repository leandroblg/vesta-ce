import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClock } from "../../../src/domain/clock";
import { orderFiles, parseFileName } from "../../../src/domain/logs/rotation";

// research §1: the logger must not load Electron (electron-log/main would register IPC listeners).
vi.mock("electron", () => {
  throw new Error("src/main/log.ts must not import electron");
});

const { initLog, log, setFloor, watch } = await import("../../../src/main/log");

const MiB = 1_048_576;
let base: string;
let dataDir: string;
const clock = fakeClock(Date.UTC(2026, 9, 19, 20, 0, 0));

function logFiles(): { name: string; size: number }[] {
  const dir = join(dataDir, "logs");
  return readdirSync(dir)
    .filter((n) => parseFileName(n) !== null)
    .map((name) => ({ name, size: statSync(join(dir, name)).size }));
}

function entries(): Record<string, unknown>[] {
  const files = logFiles();
  const order = orderFiles(files.map((f) => parseFileName(f.name) ?? 0));
  return order.flatMap((n) =>
    readFileSync(join(dataDir, "logs", `vesta-${String(n).padStart(3, "0")}.log`), "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>),
  );
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "vesta-log-"));
  dataDir = join(base, "Vesta");
  mkdirSync(dataDir, { recursive: true });
  initLog(dataDir, { clock, home: "/Users/ana" });
  setFloor("info");
});

afterEach(() => {
  try {
    chmodSync(join(dataDir, "logs"), 0o755);
  } catch {
    // not created
  }
  rmSync(base, { recursive: true, force: true });
});

describe("the Vesta logger (009 FR-001, FR-005 to FR-010, research §1)", () => {
  it("writes one JSON line per entry with the time, level, event and fields", () => {
    log.error("save.failed", { action: "edit-title", message: "SQLITE_BUSY", stack: "Error: SQLITE_BUSY\n  at x" });
    log.fatal("app.start-failed", { message: "boom" });
    expect(entries()).toEqual([
      { time: "2026-10-19T20:00:00.000Z", level: "error", event: "save.failed", action: "edit-title", message: "SQLITE_BUSY", stack: "Error: SQLITE_BUSY\n  at x" },
      { time: "2026-10-19T20:00:00.000Z", level: "fatal", event: "app.start-failed", message: "boom" },
    ]);
  });

  it("records Debug and Trace only while the floor allows them, from the next call on", () => {
    log.debug("d1");
    log.trace("t1");
    setFloor("debug");
    log.debug("d2");
    log.trace("t2");
    setFloor("trace");
    log.trace("t3");
    setFloor("info");
    log.debug("d3");
    log.info("i1");
    expect(entries().map((e) => e["event"])).toEqual(["d2", "t3", "i1"]);
  });

  it("writes the home folder as ~ (FR-003)", () => {
    log.info("app.started", { dataDir: "/Users/ana/Library/Application Support/Vesta" });
    expect(entries()[0]?.["dataDir"]).toBe("~/Library/Application Support/Vesta");
  });

  it("keeps every file at or under 1 MiB and the folder at or under 50 MiB while writing over 100 MiB (SC-001)", () => {
    const pad = "x".repeat(10_000);
    const total = 10_600; // about 101 MiB of lines
    for (let i = 0; i < total; i++) {
      log.info("bulk", { seq: i, pad });
      if (i % 500 === 0) {
        const files = logFiles();
        expect(files.every((f) => f.size <= MiB)).toBe(true);
        expect(files.reduce((s, f) => s + f.size, 0)).toBeLessThanOrEqual(50 * MiB);
      }
    }
    const files = logFiles();
    expect(files.length).toBeLessThanOrEqual(50);
    expect(files.every((f) => f.size <= MiB)).toBe(true);
    expect(files.reduce((s, f) => s + f.size, 0)).toBeLessThanOrEqual(50 * MiB);
    // Every entry not in a removed file is present exactly once, whole and in order, up to the last one.
    const seqs = entries().map((e) => e["seq"] as number);
    expect(seqs[seqs.length - 1]).toBe(total - 1);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => (seqs[0] ?? 0) + i));
  }, 60_000);

  it("continues a legacy vesta-001.log and starts vesta-002.log when it is full", () => {
    mkdirSync(join(dataDir, "logs"), { recursive: true });
    writeFileSync(join(dataDir, "logs", "vesta-001.log"), `${JSON.stringify({ time: "2026-01-01T00:00:00.000Z", level: "warn", event: "old" })}\n`);
    writeFileSync(join(dataDir, "logs", "notes.txt"), "not Vesta's");
    initLog(dataDir, { clock, home: "" });
    log.info("new");
    expect(logFiles().map((f) => f.name)).toEqual(["vesta-001.log"]);
    writeFileSync(join(dataDir, "logs", "vesta-001.log"), "y".repeat(MiB));
    initLog(dataDir, { clock, home: "" });
    log.info("after");
    expect(logFiles().map((f) => f.name).sort()).toEqual(["vesta-001.log", "vesta-002.log"]);
    expect(readFileSync(join(dataDir, "logs", "notes.txt"), "utf8")).toBe("not Vesta's");
  });

  it("falls back to stderr when the folder cannot be written, then retries it (FR-008)", () => {
    if (process.getuid?.() === 0) return; // root ignores the mode
    mkdirSync(join(dataDir, "logs"), { recursive: true });
    chmodSync(join(dataDir, "logs"), 0o500);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() => {
      log.error("save.failed", { message: "x" });
    }).not.toThrow();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('"event":"save.failed"'));
    stderr.mockRestore();
    chmodSync(join(dataDir, "logs"), 0o755);
    log.error("later");
    expect(entries().map((e) => e["event"])).toEqual(["later"]);
  });

  it("hands written entries at or above a watched level to the viewer (FR-018)", () => {
    const seen: string[] = [];
    const stop = watch("warn", (e) => seen.push(`${e.level}:${e.event}`));
    log.info("i");
    log.warn("w");
    log.fatal("f");
    stop();
    log.error("after-stop");
    expect(seen).toEqual(["warn:w", "fatal:f"]);
  });
});
