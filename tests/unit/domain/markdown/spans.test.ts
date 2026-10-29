import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import type { Paragraph, PhrasingContent, Root } from "mdast";
import { canonicalStringifyOptions, normalizeColor, spans, type VestaSpan } from "../../../../src/domain/markdown/spans";

const processor = unified().use(remarkParse).use(remarkGfm).use(spans).use(remarkStringify, canonicalStringifyOptions);

function parse(md: string): Root {
  return processor.runSync(processor.parse(md)) as Root;
}

function inline(md: string): PhrasingContent[] {
  const first = parse(md).children[0] as Paragraph;
  expect(first.type).toBe("paragraph");
  return first.children;
}

function stringify(tree: Root): string {
  return processor.stringify(tree).replace(/\n$/, "");
}

function roundTrip(md: string): string {
  return stringify(parse(md));
}

function paragraph(...children: PhrasingContent[]): Root {
  return { type: "root", children: [{ type: "paragraph", children }] };
}

function span(attrs: Partial<VestaSpan["attributes"]>, ...children: PhrasingContent[]): VestaSpan {
  return {
    type: "vestaSpan",
    attributes: {
      color: null,
      bg: null,
      size: null,
      underline: false,
      other: [],
      ...attrs,
    },
    children,
  };
}

describe("spans: parsing", () => {
  it("reads a text color span", () => {
    const [node] = inline('[t]{color="#d33"}');
    expect(node).toMatchObject({
      type: "vestaSpan",
      attributes: { color: "#dd3333ff" },
      children: [{ type: "text", value: "t" }],
    });
  });

  it("reads a background span", () => {
    expect(inline('[t]{bg="#ffe066ff"}')[0]).toMatchObject({
      type: "vestaSpan",
      attributes: { bg: "#ffe066ff" },
    });
  });

  it("reads an underline span", () => {
    expect(inline("[t]{.underline}")[0]).toMatchObject({
      type: "vestaSpan",
      attributes: { underline: true, other: [] },
    });
  });

  it("reads a font size span", () => {
    expect(inline('[t]{size="1.5em"}')[0]).toMatchObject({
      type: "vestaSpan",
      attributes: { size: "1.5em" },
    });
  });

  it("reads a combined span as one node", () => {
    const nodes = inline('[t]{color="#d33" bg="#ffe066ff" .underline}');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      type: "vestaSpan",
      attributes: {
        color: "#dd3333ff",
        bg: "#ffe066ff",
        size: null,
        underline: true,
        other: [],
      },
    });
  });

  it("reads ==t== as a mark", () => {
    expect(inline("==t==")[0]).toMatchObject({
      type: "mark",
      children: [{ type: "text", value: "t" }],
    });
  });

  it("parses formatting inside spans and marks", () => {
    expect(inline('[**b** and *i*]{color="#d33"}')[0]).toMatchObject({
      type: "vestaSpan",
      children: [{ type: "strong" }, { type: "text", value: " and " }, { type: "emphasis" }],
    });
    expect(inline("==**b**==")[0]).toMatchObject({
      type: "mark",
      children: [{ type: "strong" }],
    });
    expect(inline("[==m==]{.underline}")[0]).toMatchObject({
      type: "vestaSpan",
      children: [{ type: "mark" }],
    });
  });

  it("reads a span inside a link and a link inside a span", () => {
    expect(inline('[[t]{color="#d33"}](https://example.com)')[0]).toMatchObject({
      type: "link",
      children: [{ type: "vestaSpan" }],
    });
    expect(inline('[[t](https://example.com)]{color="#d33"}')[0]).toMatchObject({
      type: "vestaSpan",
      children: [{ type: "link" }],
    });
  });

  it("normalizes colors to 8-digit lowercase hex (011 FR-015)", () => {
    expect(inline('[t]{color="#D33"}')[0]).toMatchObject({
      attributes: { color: "#dd3333ff" },
    });
    expect(inline('[t]{bg="#FFE066"}')[0]).toMatchObject({
      attributes: { bg: "#ffe066ff" },
    });
    expect(inline('[t]{color="#dd3333cc"}')[0]).toMatchObject({
      attributes: { color: "#dd3333cc" },
    });
  });
});

describe("spans: not spans", () => {
  it("leaves a link a link", () => {
    expect(inline("[link](https://example.com)")[0]).toMatchObject({
      type: "link",
    });
  });

  it("leaves brackets alone as text", () => {
    expect(inline("[text]")).toEqual([expect.objectContaining({ type: "text", value: "[text]" })]);
  });

  it("needs the attributes right after the bracket", () => {
    expect(inline('[t] {color="#d33"}')).toEqual([expect.objectContaining({ type: "text" })]);
  });

  it("needs at least one attribute", () => {
    expect(inline("[t]{}")).toEqual([expect.objectContaining({ type: "text", value: "[t]{}" })]);
  });

  it("does not turn an image label into a span", () => {
    expect(inline('![a]{color="#d33"}').some((n) => n.type === "vestaSpan")).toBe(false);
  });

  it("needs exactly two equals signs for a mark", () => {
    expect(inline("=t=").some((n) => n.type === "mark")).toBe(false);
    expect(inline("===t===").some((n) => n.type === "mark")).toBe(false);
    expect(inline("a == b == c").some((n) => n.type === "mark")).toBe(false);
  });
});

describe("spans: serializing (FR-015, FR-015b)", () => {
  it.each([
    ["Highlight, default color", "==text=="],
    ["Highlight, chosen color", '[text]{bg="#ffe066ff"}'],
    ["Text color", '[text]{color="#dd3333ff"}'],
    ["Underline", "[text]{.underline}"],
    ["Font size", '[text]{size="1.5em"}'],
    ["Combined", '[text]{color="#dd3333ff" bg="#ffe066ff" .underline}'],
  ])("%s round-trips as %s", (_row, md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it("writes colors as 8-digit lowercase hex (011 FR-015)", () => {
    expect(roundTrip('[text]{color="#D33"}')).toBe('[text]{color="#dd3333ff"}');
    expect(roundTrip('[text]{color="#d33" bg="#FFE066" .underline}')).toBe(
      '[text]{color="#dd3333ff" bg="#ffe066ff" .underline}',
    );
  });

  it("writes attributes in the order color, bg, size, then classes", () => {
    expect(roundTrip('[t]{.underline size="2em" bg="#ffe066ff" color="#d33"}')).toBe(
      '[t]{color="#dd3333ff" bg="#ffe066ff" size="2em" .underline}',
    );
  });

  it("writes a span node built by the editor", () => {
    expect(stringify(paragraph(span({ color: "#dd3333ff", underline: true }, { type: "text", value: "x" })))).toBe(
      '[x]{color="#dd3333ff" .underline}',
    );
    expect(stringify(paragraph({ type: "mark", children: [{ type: "text", value: "x" }] }))).toBe("==x==");
  });

  it("writes formatting inside a span", () => {
    expect(roundTrip('[**b** *i*]{color="#dd3333ff"}')).toBe('[**b** *i*]{color="#dd3333ff"}');
    expect(roundTrip("==**b**==")).toBe("==**b**==");
  });

  it("writes the canonical spellings of FR-015a for other inline formatting", () => {
    expect(roundTrip("_i_ __b__ ~~s~~ `c`")).toBe("*i* **b** ~~s~~ `c`");
  });
});

describe("spans: escaping literal syntax (FR-015b)", () => {
  it.each(["[", "]", "{", "}", "==", "~~", "[t]{.underline}", "a==b==c", '[x]{color="#d33"}'])(
    "keeps %s typed as text as text",
    (literal) => {
      const md = stringify(paragraph({ type: "text", value: literal }));
      const back = inline(md);
      expect(back).toEqual([expect.objectContaining({ type: "text", value: literal })]);
      expect(roundTrip(md)).toBe(md);
    },
  );

  it("escapes braces and a double equals sign with a backslash", () => {
    expect(stringify(paragraph({ type: "text", value: "a {b} c==d" }))).toBe("a \\{b\\} c\\==d");
  });

  it("keeps an escaped span as text", () => {
    expect(inline('\\[t]{color="#d33"}').some((n) => n.type === "vestaSpan")).toBe(false);
    expect(inline("\\==t==").some((n) => n.type === "mark")).toBe(false);
  });
});

describe("spans: unknown attributes (FR-015b)", () => {
  it.each(["[t]{.foo}", '[t]{lang="x"}', '[t]{color="red"}', "[t]{#anchor}", '[t]{lang="x" .foo}'])(
    "keeps %s byte for byte",
    (md) => {
      expect(inline(md)[0]).toMatchObject({ type: "vestaSpan" });
      expect(roundTrip(md)).toBe(md);
    },
  );

  it("keeps unknown attributes after the known ones, in their order", () => {
    expect(roundTrip('[t]{.foo lang="x" .underline color="#d33"}')).toBe(
      '[t]{color="#dd3333ff" .underline .foo lang="x"}',
    );
  });

  it("records unknown attributes without visual meaning", () => {
    expect(inline("[t]{.foo}")[0]).toMatchObject({
      attributes: {
        color: null,
        bg: null,
        size: null,
        underline: false,
        other: [".foo"],
      },
    });
  });
});

describe("spans: font size bounds", () => {
  it("keeps an out-of-range size as an unknown attribute", () => {
    expect(inline('[t]{size="99999px"}')[0]).toMatchObject({ attributes: { size: null, other: ['size="99999px"'] } });
    expect(inline('[t]{size="4em"}')[0]).toMatchObject({ attributes: { size: "4em" } });
  });
});

describe("FR-015 colors are stored with 8 digits (011 data-model \"Stored color form\")", () => {
  it.each([
    ["#d33", "#dd3333ff"],
    ["#D33", "#dd3333ff"],
    ["#d33a", "#dd3333aa"],
    ["#ffe066", "#ffe066ff"],
    ["#FFE066", "#ffe066ff"],
    ["#ffe06680", "#ffe06680"],
    ["#ffe066ff", "#ffe066ff"],
  ])("FR-015 %s is stored as %s", (input, stored) => {
    expect(normalizeColor(input)).toBe(stored);
    expect(inline(`[t]{color="${input}"}`)[0]).toMatchObject({ attributes: { color: stored } });
  });

  it.each(["red", "#ffe06", "rgb(1,2,3)"])("FR-015 %s is not a color and stays verbatim", (value) => {
    expect(normalizeColor(value)).toBeNull();
    const node = inline(`[t]{color="${value}"}`)[0] as VestaSpan;
    expect(node.attributes.color).toBeNull();
    expect(node.attributes.other.join(" ")).toContain(value);
  });
});
