import { describe, expect, it } from "vitest";
import { LOG_FILE_MAX, LOG_TOTAL_MAX, fileName, orderFiles, parseFileName, planWrite } from "../../../../src/domain/logs/rotation";

const MiB = 1_048_576;
const files = (pairs: [number, number][]) => pairs.map(([number, size]) => ({ name: fileName(number), number, size }));

describe("log file names and order (009 FR-005, FR-007; research §2)", () => {
  it("limits a file to 1 MiB and all files to 50 MiB", () => {
    expect(LOG_FILE_MAX).toBe(1_048_576);
    expect(LOG_TOTAL_MAX).toBe(52_428_800);
  });

  it("names files vesta-NNN.log and ignores other names", () => {
    expect(fileName(1)).toBe("vesta-001.log");
    expect(fileName(999)).toBe("vesta-999.log");
    expect(parseFileName("vesta-042.log")).toBe(42);
    for (const other of ["vesta-1.log", "vesta-0042.log", "vesta-000.log", "vesta-042.log.bak", "notes.txt", "vesta-abc.log"]) {
      expect(parseFileName(other), other).toBeNull();
    }
  });

  it("orders files oldest to newest, the oldest being the one after the largest gap", () => {
    expect(orderFiles([3, 1, 2])).toEqual([1, 2, 3]);
    expect(orderFiles([1, 2, 998, 999])).toEqual([998, 999, 1, 2]);
    expect(orderFiles([7])).toEqual([7]);
    expect(orderFiles([])).toEqual([]);
    expect(orderFiles([500, 501, 502])).toEqual([500, 501, 502]);
    const wrapped = [...Array.from({ length: 30 }, (_, i) => 970 + i), ...Array.from({ length: 20 }, (_, i) => i + 1)];
    expect(orderFiles([...wrapped].reverse())).toEqual(wrapped);
  });
});

describe("planWrite (009 FR-005, FR-006; SC-001)", () => {
  it("starts vesta-001.log in an empty folder", () => {
    expect(planWrite([], 100)).toEqual({ file: "vesta-001.log", startNew: true, delete: [] });
  });

  it("appends while the line still fits in 1 MiB, the limit included", () => {
    expect(planWrite(files([[1, 100]]), 200)).toEqual({ file: "vesta-001.log", startNew: false, delete: [] });
    expect(planWrite(files([[1, MiB - 10]]), 10)).toEqual({ file: "vesta-001.log", startNew: false, delete: [] });
  });

  it("starts the next number when the line would pass 1 MiB, and wraps 999 to 001", () => {
    expect(planWrite(files([[1, MiB - 10]]), 11)).toEqual({ file: "vesta-002.log", startNew: true, delete: [] });
    expect(planWrite(files([[998, MiB], [999, MiB]]), 1)).toEqual({ file: "vesta-001.log", startNew: true, delete: [] });
  });

  it("deletes the oldest files first so the total never passes 50 MiB", () => {
    const full = files(Array.from({ length: 50 }, (_, i) => [i + 1, MiB] as [number, number]));
    expect(planWrite(full, 10)).toEqual({ file: "vesta-051.log", startNew: true, delete: ["vesta-001.log"] });
    const wrapped = files([...Array.from({ length: 30 }, (_, i) => [970 + i, MiB] as [number, number]), ...Array.from({ length: 20 }, (_, i) => [i + 1, MiB] as [number, number])]);
    expect(planWrite(wrapped, 10)).toEqual({ file: "vesta-021.log", startNew: true, delete: ["vesta-970.log"] });
  });

  it("counts a large legacy vesta-001.log toward the total like any other file", () => {
    expect(planWrite(files([[1, 3 * MiB]]), 10)).toEqual({ file: "vesta-002.log", startNew: true, delete: [] });
    const many = files([[1, 3 * MiB], ...Array.from({ length: 47 }, (_, i) => [i + 2, MiB] as [number, number])]);
    // 3 + 47 = 50 MiB in use: the legacy file goes first, which frees enough for the new one.
    expect(planWrite(many, 10)).toEqual({ file: "vesta-049.log", startNew: true, delete: ["vesta-001.log"] });
  });

  it("never keeps more than 50 files, even small ones", () => {
    const small = files(Array.from({ length: 50 }, (_, i) => [i + 1, MiB] as [number, number]).map(([n], i) => [n, i === 49 ? MiB : 10] as [number, number]));
    const plan = planWrite(small, 10);
    expect(plan.startNew).toBe(true);
    expect(plan.delete).toEqual(["vesta-001.log"]);
  });
});
