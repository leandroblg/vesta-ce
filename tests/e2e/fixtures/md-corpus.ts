/**
 * The 005 markdown round-trip corpus (005 FR-015a, FR-015, T041), shared by us-md-roundtrip.spec.ts and 008's
 * export/import round trip (us-export-roundtrip.spec.ts, SC-001). Moved here unchanged from the 005 spec.
 */
export type Scope = "title" | "reminder" | "details";
export const TITLE_SCOPES: Scope[] = ["title", "reminder", "details"];
export const DETAILS: Scope[] = ["details"];

// A 4 × 2 PNG and a small PDF, stored before launch.
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGM4YWT0HxkzoAsAACR1EVnFpgq+AAAAAElFTkSuQmCC",
  "base64",
);
export const PDF = Buffer.from("%PDF-1.4\n%âã\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1");

export type Step = { type: string } | { press: string } | { paste: string };
export interface Row {
  row: string;
  scopes: Scope[];
  steps: (refs: Refs) => Step[];
  stored: (refs: Refs) => string;
  /** Shown while editing and after a restart, in the editor and on the card. */
  shows: string;
}
export interface Refs {
  image: string;
  file: string;
}

export const ROWS: Row[] = [
  {
    row: "Bold, italic, inline code",
    scopes: TITLE_SCOPES,
    steps: () => [{ type: "**b** *i* `c` " }],
    stored: () => "**b** *i* `c`",
    shows: "strong",
  },
  {
    row: "Link",
    scopes: TITLE_SCOPES,
    steps: () => [{ paste: "[text](https://example.com)" }],
    stored: () => "[text](https://example.com)",
    shows: "a[href='https://example.com']",
  },
  {
    row: "Strikethrough",
    scopes: TITLE_SCOPES,
    steps: () => [{ type: "~~gone~~" }],
    stored: () => "~~gone~~",
    shows: "del",
  },
  {
    row: "Underline, text color, highlight, font size",
    scopes: TITLE_SCOPES,
    steps: () => [{ paste: '[u]{.underline} [c]{color="#dd3333"} ==h== [s]{size="1.5em"}' }],
    stored: () => '[u]{.underline} [c]{color="#dd3333ff"} ==h== [s]{size="1.5em"}',
    shows: "[data-vesta-span][data-underline]",
  },
  {
    row: "Heading",
    scopes: TITLE_SCOPES,
    steps: () => [{ type: "## Big one" }],
    stored: () => "## Big one",
    shows: "h2, [data-heading='2']",
  },
  { row: "Emoji", scopes: TITLE_SCOPES, steps: () => [{ type: ":tada: yay" }], stored: () => "🎉 yay", shows: "" },
  {
    row: "Inline image (titles, reminders) and image (details)",
    scopes: TITLE_SCOPES,
    steps: (r) => [{ paste: `![photo.png](${r.image})` }],
    stored: (r) => `![photo.png](${r.image})`,
    shows: "img:not(.ProseMirror-separator)",
  },
  {
    row: "Link to a stored file",
    scopes: DETAILS,
    steps: (r) => [{ paste: `[report.pdf](${r.file})` }],
    stored: (r) => `[report.pdf](${r.file})`,
    shows: "a",
  },
  {
    row: "Line break (details)",
    scopes: DETAILS,
    steps: () => [{ type: "line" }, { press: "Shift+Enter" }, { type: "break" }],
    stored: () => "line\\\nbreak",
    shows: "br:not(.ProseMirror-trailingBreak)",
  },
  { row: "Horizontal rule", scopes: DETAILS, steps: () => [{ type: "---" }], stored: () => "---", shows: "hr" },
  {
    row: "Bulleted and numbered lists",
    scopes: DETAILS,
    steps: () => [{ type: "- item" }],
    stored: () => "- item",
    shows: "ul li",
  },
  {
    row: "Block quote",
    scopes: DETAILS,
    steps: () => [{ type: "> quoted" }],
    stored: () => "> quoted",
    shows: "blockquote",
  },
  {
    row: "Table",
    scopes: DETAILS,
    steps: () => [{ paste: "| abc | def |\n| --- | --- |\n| 1 | 2 |" }],
    stored: () => "| abc | def |\n| --- | --- |\n| 1   | 2   |",
    shows: "table td",
  },
  {
    row: "Checklist item",
    scopes: DETAILS,
    steps: () => [{ type: "- [ ] item" }],
    stored: () => "- [ ] item",
    shows: "li[data-item-type='task']",
  },
  {
    row: "Code block",
    scopes: DETAILS,
    steps: () => [{ type: "```js " }, { type: "let a = 1;" }],
    stored: () => "```js\nlet a = 1;\n```",
    shows: "pre",
  },
  {
    row: "Collapsible section",
    scopes: DETAILS,
    steps: () => [{ paste: "<details><summary>title</summary>\n\nbody\n\n</details>" }],
    stored: () => "<details><summary>title</summary>\n\nbody\n\n</details>",
    shows: "span[data-type='html']",
  },
  {
    row: "Footnote",
    scopes: DETAILS,
    steps: () => [{ paste: "Text[^1]\n\n[^1]: note" }],
    stored: () => "Text[^1]\n\n[^1]: note",
    shows: "sup",
  },
  {
    row: "YouTube embed",
    scopes: DETAILS,
    steps: () => [{ paste: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }],
    stored: () => "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    shows: "a",
  },
  {
    row: "Inline HTML",
    scopes: DETAILS,
    steps: () => [{ paste: "a <b>bold</b> c" }],
    stored: () => "a <b>bold</b> c",
    shows: "span[data-type='html']",
  },
  // FR-015
  {
    row: "Highlight, default color",
    scopes: TITLE_SCOPES,
    steps: () => [{ type: "==marked==" }],
    stored: () => "==marked==",
    shows: "mark",
  },
  {
    row: "Highlight, chosen color",
    scopes: TITLE_SCOPES,
    steps: () => [{ paste: '[t]{bg="#ffe066"}' }],
    stored: () => '[t]{bg="#ffe066ff"}',
    shows: "[data-bg]",
  },
  {
    row: "Text color",
    scopes: TITLE_SCOPES,
    steps: () => [{ paste: '[t]{color="#d33"}' }],
    stored: () => '[t]{color="#dd3333ff"}',
    shows: "[data-color]",
  },
  {
    row: "Underline",
    scopes: TITLE_SCOPES,
    steps: () => [{ paste: "[t]{.underline}" }],
    stored: () => "[t]{.underline}",
    shows: "[data-underline]",
  },
  {
    row: "Font size",
    scopes: TITLE_SCOPES,
    steps: () => [{ paste: '[t]{size="1.5em"}' }],
    stored: () => '[t]{size="1.5em"}',
    shows: "[data-size]",
  },
  {
    row: "Combined",
    scopes: TITLE_SCOPES,
    steps: () => [{ paste: '[t]{color="#dd3333" bg="#ffe066" .underline}' }],
    stored: () => '[t]{color="#dd3333ff" bg="#ffe066ff" .underline}',
    shows: "[data-color][data-bg][data-underline]",
  },
  // 012 FR-035, A8 "survives restart, export and import": the new formatting.
  {
    row: "Font size ladder (012)",
    scopes: TITLE_SCOPES,
    steps: () => [{ paste: '[a]{size="0.75em"} [b]{size="0.875em"} [c]{size="1.25em"} [d]{size="2em"} [e]{size="2.5em"}' }],
    stored: () => '[a]{size="0.75em"} [b]{size="0.875em"} [c]{size="1.25em"} [d]{size="2em"} [e]{size="2.5em"}',
    shows: "[data-size]",
  },
  {
    row: "Checklist made from paragraphs, nested items (012)",
    scopes: DETAILS,
    steps: () => [{ paste: "- [ ] a\n  - [x] b\n- c" }],
    stored: () => "- [ ] a\n  - [x] b\n- c",
    shows: "li[data-item-type='task'] li[data-item-type='task']",
  },
  {
    row: "Text after Remove color and Remove highlight (012)",
    scopes: TITLE_SCOPES,
    steps: () => [{ paste: '[x]{size="1.25em" .underline} y' }],
    stored: () => '[x]{size="1.25em" .underline} y',
    shows: "[data-size][data-underline]",
  },
  // 013 OD1, Q172 Q179: what the list buttons make of paragraphs, indented, with a heading kept between them.
  {
    row: "List built from paragraphs, indented, split by a heading (013)",
    scopes: DETAILS,
    steps: () => [{ paste: "- one\n  - two\n\n## head\n\n- three" }],
    stored: () => "- one\n  - two\n\n## head\n\n- three",
    shows: "li li",
  },
];
