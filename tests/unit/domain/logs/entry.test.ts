import { describe, expect, it } from "vitest";
import { formatEntry, parseLine } from "../../../../src/domain/logs/entry";
import { LOG_FILE_MAX } from "../../../../src/domain/logs/rotation";

const bytes = (s: string) => new TextEncoder().encode(s).length;
const T = Date.UTC(2026, 9, 19, 20, 0, 3, 123);

describe("formatEntry (009 research §3, contracts/log-format.md)", () => {
  it("writes time, level and event first, then the fields, as one UTF-8 JSON line", () => {
    const line = formatEntry({ time: T, level: "error", event: "save.failed", fields: { action: "edit-title", message: "SQLITE_BUSY" } });
    expect(line).toBe('{"time":"2026-10-19T20:00:03.123Z","level":"error","event":"save.failed","action":"edit-title","message":"SQLITE_BUSY"}\n');
  });

  it("never lets a field replace time, level or event", () => {
    const line = formatEntry({ time: T, level: "info", event: "x", fields: { time: "no", level: "fatal", event: "y", ok: true } });
    expect(JSON.parse(line)).toEqual({ time: "2026-10-19T20:00:03.123Z", level: "info", event: "x", ok: true });
  });

  it("cuts a line over 1 MiB to fit, marks it, and never splits a character", () => {
    const huge = "😀".repeat(800_000); // 3.2 MB of 4-byte characters
    const line = formatEntry({ time: T, level: "error", event: "big", fields: { message: "m", stack: huge } });
    expect(bytes(line)).toBeLessThanOrEqual(LOG_FILE_MAX);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed["cut"]).toBe(true);
    expect(parsed["message"]).toBe("m");
    expect(parsed["stack"] as string).not.toMatch(/\uFFFD/);
    expect((parsed["stack"] as string).length % 2).toBe(0); // whole surrogate pairs only
    expect(line.endsWith("}\n")).toBe(true);
  });

  it("cuts other large values too", () => {
    const line = formatEntry({ time: T, level: "warn", event: "big", fields: { ids: Array.from({ length: 200_000 }, (_, i) => `id-${String(i)}`) } });
    expect(bytes(line)).toBeLessThanOrEqual(LOG_FILE_MAX);
    expect((JSON.parse(line) as Record<string, unknown>)["cut"]).toBe(true);
  });

  it("does not mark a line that fits", () => {
    expect(formatEntry({ time: T, level: "info", event: "x", fields: {} })).not.toContain("cut");
  });
});

describe("parseLine (009 FR-011; spec edge case)", () => {
  it("reads every level, the legacy names included", () => {
    for (const level of ["fatal", "error", "warn", "info", "debug", "trace"]) {
      const r = parseLine(`{"time":"2026-10-19T20:00:03.123Z","level":"${level}","event":"e","n":1}`);
      expect(r).toEqual({ kind: "entry", entry: { time: T, level, event: "e", fields: { n: 1 }, cut: false } });
    }
    expect(parseLine('{"time":"2026-10-19T20:00:03.123Z","level":"error","event":"e","cut":true}')).toMatchObject({ kind: "entry", entry: { cut: true, fields: {} } });
  });

  it("keeps any other line as raw text", () => {
    for (const text of ['{"time":"2026-10-19T20:00:03.123Z","level":"in', "not json", "[1,2]", '{"level":"verbose","event":"e"}', '"text"']) {
      expect(parseLine(text), text).toEqual({ kind: "raw", text });
    }
  });

  it("keeps an entry whose time cannot be read, with no time", () => {
    expect(parseLine('{"time":"yesterday","level":"info","event":"e"}')).toEqual({ kind: "entry", entry: { time: null, level: "info", event: "e", fields: {}, cut: false } });
  });
});
