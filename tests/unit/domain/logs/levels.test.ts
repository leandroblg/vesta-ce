import { describe, expect, it } from "vitest";
import { LEVELS, isLogLevel, recordFloor, records, shows, type LogLevel } from "../../../../src/domain/logs/levels";

describe("log levels (009 FR-002, FR-010, FR-017; PRD Q123)", () => {
  it("lists the six levels from most to least important", () => {
    expect(LEVELS).toEqual(["fatal", "error", "warn", "info", "debug", "trace"]);
  });

  it("records Fatal to Info always, Debug and Trace only while selected", () => {
    expect(recordFloor("fatal")).toBe("info");
    expect(recordFloor("error")).toBe("info");
    expect(recordFloor("warn")).toBe("info");
    expect(recordFloor("info")).toBe("info");
    expect(recordFloor("debug")).toBe("debug");
    expect(recordFloor("trace")).toBe("trace");
  });

  it("records a level at or above the floor", () => {
    const table: Record<"info" | "debug" | "trace", LogLevel[]> = {
      info: ["fatal", "error", "warn", "info"],
      debug: ["fatal", "error", "warn", "info", "debug"],
      trace: ["fatal", "error", "warn", "info", "debug", "trace"],
    };
    for (const [floor, recorded] of Object.entries(table) as ["info" | "debug" | "trace", LogLevel[]][]) {
      for (const level of LEVELS) expect(records(level, floor), `${level} @ ${floor}`).toBe(recorded.includes(level));
    }
  });

  it("shows the selected level and every more important one", () => {
    for (const [i, selected] of LEVELS.entries()) {
      for (const [j, level] of LEVELS.entries()) expect(shows(level, selected), `${level} @ ${selected}`).toBe(j <= i);
    }
    expect(LEVELS.filter((l) => shows(l, "fatal"))).toEqual(["fatal"]);
    expect(LEVELS.filter((l) => shows(l, "trace"))).toEqual(LEVELS);
  });

  it("accepts the six names only", () => {
    for (const l of LEVELS) expect(isLogLevel(l)).toBe(true);
    for (const bad of ["warning", "Warn", "", null, undefined, 3, "verbose", "silly"]) expect(isLogLevel(bad)).toBe(false);
  });
});
