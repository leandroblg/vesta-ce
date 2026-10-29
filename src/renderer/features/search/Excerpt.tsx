/** The one-line details excerpt on a card that matched through its details (006 FR-013, FR-014). */
export function Excerpt({ text }: { text: string }) {
  // data-hl: the search highlight covers it (highlight.ts). Display only: never stored (constitution III).
  return (
    <div className="search-excerpt" data-hl="">
      {text}
    </div>
  );
}
