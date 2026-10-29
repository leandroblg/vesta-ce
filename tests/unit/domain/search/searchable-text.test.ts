// T003: the searchable text of stored markdown (006 spec FR-003, FR-004d, SC-002; research §2).
import { describe, expect, it } from "vitest";
import { searchableText } from "../../../../src/domain/search/searchable-text";

const PNG = `assets/${"a".repeat(64)}.png`;
const PDF = `assets/${"b".repeat(64)}.pdf`;
const details = (md: string) => searchableText(md, "details");
const title = (md: string) => searchableText(md, "title");

describe("searchableText: one test per PRD A5 row (SC-002)", () => {
  it("Bold, italic, inline code, links", () => {
    expect(details("**bold** *italic* `npm test` [the form](https://example.com/abc)")).toBe(
      "bold italic npm test the form",
    );
    expect(title("**Renew** passport")).toBe("Renew passport");
  });

  it("Strikethrough, underline", () => {
    expect(details("~~gone~~ [under]{.underline}")).toBe("gone under");
  });

  it("Text color (free picker)", () => {
    expect(details('[red text]{color="#c00"} after')).toBe("red text after");
  });

  it("Highlight / background color (free picker)", () => {
    expect(details('==marked== [shaded]{bg="#ffe066"}')).toBe("marked shaded");
  });

  it("Font size / headings", () => {
    expect(details('# Heading one\n\n[big]{size="1.5em"} words')).toBe("Heading one big words");
    expect(title("## Quarterly report")).toBe("Quarterly report");
  });

  it("Emojis", () => {
    expect(details("Party 🎉 time")).toBe("Party 🎉 time");
  });

  it("Inline images, scaled to font height (titles)", () => {
    expect(title(`Chart ![report-chart.png](${PNG}) here`)).toBe("Chart report-chart.png here");
  });

  it("Line breaks, horizontal rules", () => {
    expect(details("first\\\nsecond\n\n---\n\nthird")).toBe("first second third");
  });

  it("Lists, block quotes", () => {
    expect(details("- one\n- two\n\n1. three\n\n> quoted words")).toBe("one two three quoted words");
  });

  it("Tables", () => {
    expect(details("| Name | Qty |\n| :--- | ---: |\n| apples | 3 |")).toBe("Name Qty apples 3");
  });

  it("Checklists", () => {
    expect(details("- [ ] buy milk\n- [x] call bank")).toBe("buy milk call bank");
  });

  it("Images and links to local files", () => {
    expect(details(`![screenshot.png](${PNG})\n\n[contract.pdf](${PDF})`)).toBe("screenshot.png contract.pdf");
    // A link to a stored file whose text the user changed: the shown text, never the hash.
    expect(details(`[the signed copy](${PDF})`)).toBe("the signed copy");
  });

  it("Code blocks with syntax highlighting", () => {
    expect(details("```js\nconst total = 1;\nlet x = 2;\n```")).toBe("const total = 1; let x = 2;");
  });

  it("Collapsible sections", () => {
    expect(details("<details><summary>More info</summary>\n\nHidden body\n\n</details>")).toBe("More info Hidden body");
  });

  it("Footnotes", () => {
    expect(details("Claim[^1] stands.\n\n[^1]: The source text.")).toBe("Claim stands. The source text.");
  });

  it("YouTube video embeds", () => {
    expect(details("Watch this:\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nafter")).toBe("Watch this: after");
    expect(details("https://youtu.be/dQw4w9WgXcQ")).toBe("");
  });

  it("Inline HTML", () => {
    expect(details("a <b>bold</b> word")).toBe("a bold word");
    expect(details('<span title="secret">visible</span>')).toBe("visible");
  });
});

describe("searchableText: FR-003 constructs", () => {
  it("excludes link addresses and stored file names", () => {
    const text = details(`[docs](https://example.com/abc) ![shot.png](${PNG})`);
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("aaaa");
    expect(text).toBe("docs shot.png");
  });

  it("decodes character references, in text and inside HTML", () => {
    expect(details("Fish &amp; chips")).toBe("Fish & chips");
    expect(details("<i>caf&#233; &amp; bar</i>")).toBe("café & bar");
    expect(details("<p>x&#x41;y&nbsp;z</p>")).toBe("xAy z");
  });

  it("keeps characters shown through escaping", () => {
    expect(details("\\*not bold\\* and \\[x\\]")).toBe("*not bold* and [x]");
  });

  it("excludes the attribute syntax, keeping only the text it wraps", () => {
    expect(details('[text]{color="#c00" bg="#fff" .underline}')).toBe("text");
  });

  it("excludes code-fence languages, footnote markers and checklist boxes", () => {
    expect(details("```python\nprint(1)\n```")).toBe("print(1)");
    expect(details("A[^note]\n\n[^note]: B")).toBe("A B");
    expect(details("- [x] done item")).toBe("done item");
  });
});

describe("searchableText: boundaries (FR-004d)", () => {
  it("turns block boundaries into spaces, so no word spans two blocks", () => {
    expect(details("pass\n\nport")).toBe("pass port");
    expect(details("- pass\n- port")).toBe("pass port");
    expect(details("| pass | port |\n| --- | --- |\n| a | b |")).toBe("pass port a b");
  });

  it("joins inline HTML with no space, but treats line-breaking tags as spaces", () => {
    expect(details("<b>Fri</b>day")).toBe("Friday");
    expect(details("one<br>two")).toBe("one two");
  });

  it("joins formatting runs with no space", () => {
    expect(details("Fri**day** and **sat**urday")).toBe("Friday and saturday");
  });

  it("collapses whitespace runs to one space and trims", () => {
    expect(details("  a\t\tb\n\n\n   c  ")).toBe("a b c");
    expect(details("")).toBe("");
    expect(details("   ")).toBe("");
  });
});

describe("searchableText: title scope", () => {
  it("shows HTML and block syntax as typed, as the card does (005 FR-035b, FR-015b)", () => {
    expect(title("<b>bold</b> title")).toBe("<b>bold</b> title");
    expect(title("- a list item")).toBe("- a list item");
  });
});

describe("searchableText never throws", () => {
  it("returns the markdown with whitespace collapsed when parsing fails, and reports the error", () => {
    const errors: unknown[] = [];
    const failing = () => {
      throw new Error("boom");
    };
    expect(searchableText("  **a**\n\nb  ", "details", { parse: failing, onError: (e) => errors.push(e) })).toBe("**a** b");
    expect(errors).toHaveLength(1);
  });
});
