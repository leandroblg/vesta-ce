// PRD A5's Formatting table (spec FR-014) as data: the editor presets, the floating menu and the tests read it.

export type Feature =
  | "bold-italic-code-links"
  | "strikethrough-underline"
  | "text-color"
  | "highlight"
  | "font-size-headings"
  | "emoji"
  | "inline-images"
  | "line-breaks-rules"
  | "lists-quotes"
  | "tables"
  | "checklists"
  | "local-files"
  | "code-blocks"
  | "collapsible"
  | "footnotes"
  | "youtube"
  | "inline-html";

/** `title` is the "Titles & reminders" column; `details` the "Details" column. */
export const FEATURES: readonly { id: Feature; title: boolean; details: boolean }[] = [
  { id: "bold-italic-code-links", title: true, details: true },
  { id: "strikethrough-underline", title: true, details: true },
  { id: "text-color", title: true, details: true },
  { id: "highlight", title: true, details: true },
  { id: "font-size-headings", title: true, details: true },
  { id: "emoji", title: true, details: true },
  { id: "inline-images", title: true, details: false },
  { id: "line-breaks-rules", title: false, details: true },
  { id: "lists-quotes", title: false, details: true },
  { id: "tables", title: false, details: true },
  { id: "checklists", title: false, details: true },
  { id: "local-files", title: false, details: true },
  { id: "code-blocks", title: false, details: true },
  { id: "collapsible", title: false, details: true },
  { id: "footnotes", title: false, details: true },
  { id: "youtube", title: false, details: true },
  { id: "inline-html", title: false, details: true },
];

/** Titles and reminders share one scope. */
export type Scope = "title" | "details";

export const SCOPES: Readonly<Record<Scope, readonly Feature[]>> = {
  title: FEATURES.filter((f) => f.title).map((f) => f.id),
  details: FEATURES.filter((f) => f.details).map((f) => f.id),
};

export function inScope(scope: Scope, feature: Feature): boolean {
  return SCOPES[scope].includes(feature);
}
