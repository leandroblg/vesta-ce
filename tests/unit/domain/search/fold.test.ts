// T005: folding case and accents, with an offset map back to the original text (006 FR-004, FR-004b, FR-004e).
import { describe, expect, it } from "vitest";
import { fold } from "../../../../src/domain/search/fold";

const f = (s: string, matchCase = false) => fold(s, { matchCase }).folded;

describe("fold", () => {
  it("removes accent marks and lowercases", () => {
    expect(f("Ação Résumé")).toBe("acao resume");
    expect(f("é è ê ç ñ ã õ ü")).toBe("e e e c n a o u");
  });

  it("treats composed and decomposed forms alike", () => {
    expect(f("café")).toBe(f("café"));
    expect(f("café")).toBe("cafe");
  });

  it("keeps letters that are not a base letter plus a mark", () => {
    expect(f("Ø æ Œ ß ł")).toBe("ø æ œ ß ł");
  });

  it("keeps case with matchCase, still removing accents", () => {
    expect(f("Ação", true)).toBe("Acao");
    expect(f("API keys", true)).toBe("API keys");
  });

  it("is the same in every interface language (no locale-specific casing)", () => {
    expect(f("ISTANBUL")).toBe("istanbul");
    expect(f("İ")).toBe("i");
  });

  it("maps each folded character back to where it came from", () => {
    const text = "café Bar";
    const { folded, map, ends } = fold(text, { matchCase: false });
    expect(folded).toBe("cafe bar");
    // "e" came from index 3; the removed mark at 4 extends its end to 5.
    expect(map[3]).toBe(3);
    expect(ends[3]).toBe(5);
    // " bar" starts at original index 5.
    expect(map[4]).toBe(5);
    expect(text.slice(map[5] ?? -1, ends[7])).toBe("Bar");
  });

  it("maps characters outside the basic plane by their whole surrogate pair", () => {
    const text = "a🎉b";
    const { folded, map, ends } = fold(text, { matchCase: false });
    expect(folded).toBe("a🎉b");
    expect(map[1]).toBe(1);
    expect(ends[2]).toBe(3);
    expect(map[3]).toBe(3);
  });

  it("returns empty output for empty input", () => {
    expect(fold("", { matchCase: false })).toEqual({ folded: "", map: [], ends: [] });
  });
});
