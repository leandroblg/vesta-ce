import { describe, expect, it } from "vitest";
import { plainText } from "../../../../src/domain/markdown/plain-text";

const REF = `assets/${"a".repeat(64)}.png`;

describe("plainText", () => {
  it("drops markup, spans and keeps image alt text", () => {
    expect(plainText(`**Renew** [passport]{color="#d33"} ![x](${REF})`)).toBe("Renew passport x");
  });

  it("gives the text of headings, links, code and escapes", () => {
    expect(plainText("# Title")).toBe("Title");
    expect(plainText("[docs](https://example.com) and `npm test`")).toBe("docs and npm test");
    expect(plainText("\\*not bold\\* ==marked== ~~gone~~")).toBe("*not bold* marked gone");
    expect(plainText("```js\nlet a = 1;\n```")).toBe("let a = 1;");
  });

  it("separates blocks with a space", () => {
    expect(plainText("one\n\n- two\n- three\n\n> four")).toBe("one two three four");
    expect(plainText("line\\\nbreak")).toBe("line break");
  });

  it("strips HTML tags", () => {
    expect(plainText("a <b>bold</b> word")).toBe("a bold word");
    expect(plainText("<details><summary>More</summary>\n\nInside\n\n</details>")).toBe("More Inside");
  });

  it("gives an empty string for empty input", () => {
    expect(plainText("")).toBe("");
    expect(plainText("   ")).toBe("");
  });
});
