import { describe, expect, it } from "vitest";
import { FEATURES, SCOPES } from "../../../../src/domain/markdown/scope";

// PRD A5's Formatting table, as spec FR-014 copies it.
const TABLE: [string, boolean, boolean][] = [
  ["bold-italic-code-links", true, true],
  ["strikethrough-underline", true, true],
  ["text-color", true, true],
  ["highlight", true, true],
  ["font-size-headings", true, true],
  ["emoji", true, true],
  ["inline-images", true, false],
  ["line-breaks-rules", false, true],
  ["lists-quotes", false, true],
  ["tables", false, true],
  ["checklists", false, true],
  ["local-files", false, true],
  ["code-blocks", false, true],
  ["collapsible", false, true],
  ["footnotes", false, true],
  ["youtube", false, true],
  ["inline-html", false, true],
];

describe("formatting scopes (FR-014)", () => {
  it("lists the 17 rows of the table", () => {
    expect(FEATURES.map((f) => [f.id, f.title, f.details])).toEqual(TABLE);
  });

  it("derives the two columns", () => {
    expect(SCOPES.title).toEqual(TABLE.filter(([, title]) => title).map(([id]) => id));
    expect(SCOPES.details).toEqual(TABLE.filter(([, , details]) => details).map(([id]) => id));
    expect(SCOPES.title).toHaveLength(7);
    expect(SCOPES.details).toHaveLength(16);
  });
});
