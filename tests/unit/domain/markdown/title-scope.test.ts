import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../../../src/domain/markdown/parse";
import { flattenToTitleScope } from "../../../../src/domain/markdown/title-scope";

const REF = `assets/${"a".repeat(64)}.png`;

function flat(md: string) {
  const tree = parseMarkdown(md);
  flattenToTitleScope(tree, md);
  return tree;
}

describe("flattenToTitleScope (FR-014, FR-015b)", () => {
  it("keeps one paragraph or heading with title-scope inline formatting", () => {
    const tree = flat('# **b** [x]{color="#d33"} ==m== ~~s~~ `c` [l](https://example.com)');
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]).toMatchObject({ type: "heading", depth: 1 });
    const types = (tree.children[0] as { children: { type: string }[] }).children.map((c) => c.type);
    expect(types).toEqual(expect.arrayContaining(["strong", "vestaSpan", "mark", "delete", "inlineCode", "link"]));
  });

  it("keeps stored images and turns other images into their source text", () => {
    const tree = flat(`a ![p](${REF}) ![r](https://example.com/x.png)`);
    const kids = (tree.children[0] as { children: { type: string; value?: string }[] }).children;
    expect(kids.map((k) => k.type)).toEqual(["text", "image", "text", "text"]);
    expect(kids[3]?.value).toBe("![r](https://example.com/x.png)");
  });

  it.each(["- item", "> quote", "1. one", "---", "```js", "<div>x</div>"])("turns the block %j into its text", (md) => {
    expect(flat(md).children).toEqual([
      { type: "paragraph", children: [{ type: "text", value: md }], position: expect.anything() as unknown },
    ]);
  });

  it("turns inline HTML and footnote references into text", () => {
    const kids = (flat("a <b>x</b> [^1]").children[0] as { children: { type: string; value?: string }[] }).children;
    expect(kids.every((k) => k.type === "text")).toBe(true);
    expect(kids.map((k) => k.value).join("")).toBe("a <b>x</b> [^1]");
  });

  it("gives an empty tree for empty text", () => {
    expect(flat("").children).toEqual([]);
  });
});
