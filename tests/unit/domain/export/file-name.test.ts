// T009: the export file name (FR-010): today's local date, never overwriting.
import { describe, expect, it } from "vitest";
import { exportFileName, localDate } from "../../../../src/domain/export/file-name";

describe("exportFileName", () => {
  it("uses the date as given", () => {
    expect(exportFileName("2026-10-19", new Set())).toBe("vesta-export-2026-10-19.zip");
  });

  it("adds -2, -3, … when the name is taken", () => {
    expect(exportFileName("2026-10-19", new Set(["vesta-export-2026-10-19.zip"]))).toBe("vesta-export-2026-10-19-2.zip");
    expect(exportFileName("2026-10-19", new Set(["vesta-export-2026-10-19.zip", "vesta-export-2026-10-19-2.zip"]))).toBe(
      "vesta-export-2026-10-19-3.zip",
    );
  });

  it("does not skip a free -2 because -3 is taken", () => {
    expect(exportFileName("2026-10-19", new Set(["vesta-export-2026-10-19.zip", "vesta-export-2026-10-19-3.zip"]))).toBe(
      "vesta-export-2026-10-19-2.zip",
    );
  });
});

describe("localDate", () => {
  it("formats the local calendar date for a time zone offset", () => {
    // 2026-10-19 23:30 UTC is already 2026-10-20 in UTC+2 and still 2026-10-19 in UTC-3.
    const t = Date.UTC(2026, 9, 19, 23, 30);
    expect(localDate(t, -120)).toBe("2026-10-20");
    expect(localDate(t, 180)).toBe("2026-10-19");
    expect(localDate(Date.UTC(2026, 0, 5, 12), 0)).toBe("2026-01-05");
  });
});
