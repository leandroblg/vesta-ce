// T007: query parsing, the exact matching rules and highlight ranges (006 FR-002, FR-004 to FR-004d, FR-012).
import { describe, expect, it } from "vitest";
import { parseQuery } from "../../../../src/domain/search/query";
import { findRanges, matchDoc } from "../../../../src/domain/search/match";

const DEFAULT = { matchCase: false, exactPhrase: false };
const PHRASE = { matchCase: false, exactPhrase: true };
const CASE = { matchCase: true, exactPhrase: false };

function m(text: string, titlePlain: string, bodyPlain = "", opts = DEFAULT) {
  return matchDoc(parseQuery(text, opts), { titlePlain, bodyPlain }, opts);
}

describe("parseQuery", () => {
  it("is empty for empty or whitespace-only text (FR-002)", () => {
    expect(parseQuery("", DEFAULT).terms).toEqual([]);
    expect(parseQuery(" \t \n ", DEFAULT).terms).toEqual([]);
    expect(parseQuery("   ", PHRASE).terms).toEqual([]);
  });

  it("splits words at any whitespace (FR-004d)", () => {
    expect(parseQuery(" sales\treport q3\nfinal ", DEFAULT).terms).toEqual(["sales", "report", "q3", "final"]);
  });

  it("keeps one collapsed phrase with Exact phrase (FR-004a)", () => {
    expect(parseQuery("  sales   report\n", PHRASE).terms).toEqual(["sales report"]);
  });
});

describe("matchDoc: default mode (FR-004)", () => {
  it("needs every word, in any order, across title and details together", () => {
    expect(m("report sales", "Sales report").matched).toBe(true);
    expect(m("report sales", "Report", "about sales").matched).toBe(true);
    expect(m("report sales", "Report").matched).toBe(false);
  });

  it("matches partial words and single characters", () => {
    expect(m("port", "Renew passport").matched).toBe(true);
    expect(m("x", "Fix bike").matched).toBe(true);
  });

  it("matches special characters literally", () => {
    for (const ch of ["*", "%", "_", '"', "(", "-", ":"]) {
      expect(m(ch, `a ${ch} b`).matched).toBe(true);
      expect(m(ch, "plain words").matched).toBe(false);
    }
  });

  it("ignores case and accents", () => {
    expect(m("acao RESUME", "Ação", "my résumé").matched).toBe(true);
  });

  it("never matches a word across the title/details boundary", () => {
    expect(m("passport", "Renew pass", "port details").matched).toBe(false);
  });

  it("reports inTitle only when the title alone satisfies the query", () => {
    expect(m("sales report", "Sales report", "sales").inTitle).toBe(true);
    expect(m("sales invoice", "Sales report", "invoice 2291").inTitle).toBe(false);
    expect(m("2291", "Paid", "invoice 2291")).toEqual({ matched: true, inTitle: false });
  });

  it("does not match with no terms", () => {
    expect(m("   ", "anything").matched).toBe(false);
  });
});

describe("matchDoc: Exact phrase (FR-004a)", () => {
  it("needs the words in order", () => {
    expect(m("sales report", "Sales report", "", PHRASE).matched).toBe(true);
    expect(m("sales report", "Report on sales", "", PHRASE).matched).toBe(false);
  });

  it("crosses block boundaries within one field (they are spaces)", () => {
    expect(m("before friday", "Call", "the bank before friday", PHRASE).matched).toBe(true);
  });

  it("may start and end inside words", () => {
    expect(m("es rep", "Sales report", "", PHRASE).matched).toBe(true);
  });

  it("never spans from the title into the details", () => {
    expect(m("report sales", "Quarterly report", "sales numbers", PHRASE).matched).toBe(false);
  });

  it("with one word behaves as without the toggle", () => {
    expect(m("port", "passport", "", PHRASE)).toEqual(m("port", "passport"));
  });
});

describe("matchDoc: Match case (FR-004b)", () => {
  it("respects case but still ignores accents", () => {
    expect(m("API", "API keys", "", CASE).matched).toBe(true);
    expect(m("API", "rapid fix", "", CASE).matched).toBe(false);
    expect(m("Ação", "Acao", "", CASE).matched).toBe(true);
    expect(m("ação", "Acao", "", CASE).matched).toBe(false);
  });

  it("combines with Exact phrase", () => {
    const both = { matchCase: true, exactPhrase: true };
    expect(m("Sales report", "Sales report", "", both).matched).toBe(true);
    expect(m("sales report", "Sales report", "", both).matched).toBe(false);
  });
});

describe("findRanges (FR-012)", () => {
  const ranges = (text: string, q: string, opts = DEFAULT) => findRanges(text, parseQuery(q, opts), opts);

  it("finds every occurrence of each word, in original offsets, sorted", () => {
    expect(ranges("pass the passport", "pass")).toEqual([
      [0, 4],
      [9, 13],
    ]);
    expect(ranges("sales report sales", "report sales")).toEqual([
      [0, 5],
      [6, 12],
      [13, 18],
    ]);
  });

  it("maps offsets back past removed accent marks", () => {
    const text = "café au lait";
    expect(ranges(text, "cafe")).toEqual([[0, 5]]);
    expect(ranges("Résumé", "resume")).toEqual([[0, 6]]);
  });

  it("finds the whole phrase across any whitespace in the shown text", () => {
    expect(ranges("before\n  friday", "before friday", PHRASE)).toEqual([[0, 15]]);
  });

  it("follows Match case", () => {
    expect(ranges("API rapid", "API", CASE)).toEqual([[0, 3]]);
    expect(ranges("API rapid", "api")).toEqual([
      [0, 3],
      [5, 8],
    ]);
  });

  it("merges overlapping ranges", () => {
    expect(ranges("passport", "pass ssp")).toEqual([[0, 5]]);
  });

  it("returns nothing for no terms or no match", () => {
    expect(ranges("text", "")).toEqual([]);
    expect(ranges("text", "zzz")).toEqual([]);
  });
});
