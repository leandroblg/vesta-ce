import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLogPage } from "../../../../src/main/logs/reader";
import { budget } from "../../perf-budget";

let base: string;
let dir: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "vesta-reader-"));
  dir = join(base, "logs");
  mkdirSync(dir);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);
const line = (seq: number, level: string, extra = "") =>
  `${JSON.stringify({ time: new Date(T0 + seq * 1000).toISOString(), level, event: "seed", seq, pad: extra })}\n`;

/** Writes files in order (oldest first); entry levels cycle through `levels`. */
function seed(numbers: number[], perFile: number, levels: string[], pad: string): void {
  let seq = 0;
  for (const n of numbers) {
    let text = "";
    for (let i = 0; i < perFile; i++) {
      text += line(seq, levels[seq % levels.length] ?? "info", pad);
      seq++;
    }
    writeFileSync(join(dir, `vesta-${String(n).padStart(3, "0")}.log`), text);
  }
}

describe("readLogPage, speed (009 SC-003, SC-004)", () => {
  it("opens 50 MiB of logs fast, and a level switch is fast too (SC-003, SC-004)", async () => {
    seed(Array.from({ length: 50 }, (_, i) => i + 1), 1000, ["info", "info", "warn", "debug", "error"], "x".repeat(900));
    let t = performance.now();
    const first = await readLogPage(dir, null, "info");
    const firstMs = performance.now() - t;
    t = performance.now();
    await readLogPage(dir, null, "error");
    const switchMs = performance.now() - t;
    expect(first.lines).toHaveLength(400);
    expect(firstMs).toBeLessThan(budget(300));
    expect(switchMs).toBeLessThan(budget(300));
    console.log(`reader: first page ${firstMs.toFixed(1)} ms, level switch ${switchMs.toFixed(1)} ms`);
  }, 60_000);
});
