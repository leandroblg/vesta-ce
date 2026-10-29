import { describe, expect, it } from "vitest";
import { normalizeTitle } from "../../../src/domain/title";

describe("normalizeTitle (FR-019)", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeTitle("  Renew passport  ")).toBe("Renew passport");
  });

  it("turns line breaks into single spaces", () => {
    expect(normalizeTitle("Draft\nsummary")).toBe("Draft summary");
    expect(normalizeTitle("Draft\r\nsummary")).toBe("Draft summary");
    expect(normalizeTitle("Draft  \n\n  summary")).toBe("Draft summary");
    expect(normalizeTitle("Draft<br>summary<br />now")).toBe("Draft summary now");
  });

  it("returns null for empty or whitespace-only titles", () => {
    expect(normalizeTitle("")).toBeNull();
    expect(normalizeTitle("   ")).toBeNull();
    expect(normalizeTitle("\n\r\n")).toBeNull();
    expect(normalizeTitle("<br>")).toBeNull();
  });

  it("keeps markdown markers as typed", () => {
    expect(normalizeTitle("Prepare **quarterly** [report]{color=\"#2f6fb0\"} 🦷")).toBe(
      "Prepare **quarterly** [report]{color=\"#2f6fb0\"} 🦷",
    );
  });

  it("keeps inner spaces that are not around a line break", () => {
    expect(normalizeTitle("a  b")).toBe("a  b");
  });
});
