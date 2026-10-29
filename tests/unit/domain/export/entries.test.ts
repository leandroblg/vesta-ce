// T007: zip entry names (research §3, FR-023, FR-024). Names are classified, never used as paths.
import { describe, expect, it } from "vitest";
import { classifyEntry } from "../../../../src/domain/export/entries";

const H = "0123456789abcdef".repeat(4);

describe("classifyEntry", () => {
  it("recognizes data.json", () => {
    expect(classifyEntry("data.json")).toEqual({ kind: "data" });
  });

  it("recognizes stored files with and without an extension", () => {
    expect(classifyEntry(`assets/${H}.png`)).toEqual({ kind: "asset", sha256: H, ext: "png" });
    expect(classifyEntry(`assets/${H}`)).toEqual({ kind: "asset", sha256: H, ext: "" });
    expect(classifyEntry(`assets/${H}.${"a".repeat(16)}`)).toEqual({ kind: "asset", sha256: H, ext: "a".repeat(16) });
  });

  it("recognizes log entries", () => {
    expect(classifyEntry("logs/vesta-001.log")).toEqual({ kind: "log" });
    expect(classifyEntry("logs/sub/x")).toEqual({ kind: "log" });
  });

  it("classifies everything else, including traversal attempts, as other", () => {
    for (const name of [
      `assets/${H.slice(1)}.png`,
      `assets/${H.toUpperCase()}.png`,
      `assets/${H}.PNG`,
      `assets/${H}.${"a".repeat(17)}`,
      `assets/${H}.png/`,
      `assets/${H}.p.ng`,
      "../data.json",
      "/etc/passwd",
      "/data.json",
      "assets/../x",
      `assets/../assets/${H}.png`,
      "a\\b",
      `assets\\${H}.png`,
      "C:/x",
      "data.json/",
      "Data.json",
      "__MACOSX/data.json",
      "logs/../data.json",
      "logs/..",
      "logs/",
      "",
    ]) {
      expect(classifyEntry(name), name).toEqual({ kind: "other" });
    }
  });
});
