// T009: the one-line details excerpt (006 FR-013).
import { describe, expect, it } from "vitest";
import { excerpt } from "../../../../src/domain/search/excerpt";
import { parseQuery } from "../../../../src/domain/search/query";

const DEFAULT = { matchCase: false, exactPhrase: false };
const PHRASE = { matchCase: false, exactPhrase: true };
const ex = (body: string, title: string, q: string, opts = DEFAULT) => excerpt(body, title, parseQuery(q, opts), opts);

const words = (n: number, prefix = "w") => Array.from({ length: n }, (_, i) => `${prefix}${String(i)}`).join(" ");

describe("excerpt", () => {
  it("returns a short body whole, with no marks", () => {
    expect(ex("paid by bank transfer, invoice 2291, due Friday", "Paid", "2291")).toBe(
      "paid by bank transfer, invoice 2291, due Friday",
    );
  });

  it("is at most 120 characters, cut at word boundaries, with … where text is left out", () => {
    const body = `${words(60, "a")} invoice 2291 ${words(60, "b")}`;
    const out = ex(body, "Paid", "2291") ?? "";
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toContain("invoice 2291");
    const inner = out.slice(1, -1);
    // Whole words only: every piece is a word of the body.
    for (const w of inner.trim().split(" ")) expect(body.split(" ")).toContain(w);
  });

  it("marks only the side where text is left out", () => {
    const start = ex(`2291 is the number ${words(60)}`, "Paid", "2291") ?? "";
    expect(start.startsWith("2291")).toBe(true);
    expect(start.endsWith("…")).toBe(true);
    const end = ex(`${words(60)} the number is 2291`, "Paid", "2291") ?? "";
    expect(end.startsWith("…")).toBe(true);
    expect(end.endsWith("2291")).toBe(true);
  });

  it("centres on the first search word, in typed order, that the title lacks", () => {
    const body = `${words(40, "x")} sales ${words(40, "y")} invoice ${words(40, "z")}`;
    // "sales" is in the title, so the excerpt centres on "invoice".
    expect(ex(body, "Sales report", "sales invoice")).toContain("invoice");
    expect(ex(body, "Sales report", "sales invoice")).not.toContain(" sales ");
  });

  it("centres on the phrase with Exact phrase", () => {
    const body = `${words(40, "x")} before friday ${words(40, "y")}`;
    expect(ex(body, "Call", "before friday", PHRASE)).toContain("before friday");
  });

  it("matches case- and accent-insensitively, returning the original text", () => {
    expect(ex("Meeting at the Café Rouge", "Lunch", "cafe")).toBe("Meeting at the Café Rouge");
  });

  it("is null when the details contain none of the missing terms, or the title matches alone", () => {
    expect(ex("nothing here", "Paid", "2291")).toBeNull();
    expect(ex("invoice 2291", "Invoice 2291", "2291")).toBeNull();
    expect(ex("", "Paid", "2291")).toBeNull();
  });

  it("handles a 10,000-character body quickly", () => {
    const body = `${"lorem ipsum ".repeat(830)}needle ${"dolor ".repeat(10)}`;
    // The best of several batches after a warm-up: a busy machine (the full suite in parallel) slows one
    // batch, not the code.
    ex(body, "Title", "needle");
    let best = Infinity;
    for (let batch = 0; batch < 5; batch++) {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) ex(body, "Title", "needle");
      best = Math.min(best, (performance.now() - t0) / 20);
    }
    expect(best).toBeLessThan(1);
  });
});
