/**
 * The card click area (011 FR-022 to FR-025, contracts/ui.md "Card click area"): from right after the checkbox (or
 * the collapse arrow) to just before the drag grip, over the card's full height, tags and the search excerpt
 * included. The controls keep their own clicks, and a press that moved 4 px or more is no click (FR-024). A link's
 * single click never arrives (Markdown opens it and stops it); its double click edits the title, as before 011.
 */
const NOT_AREA = ".cb, .twisty, .actions, .grip, .inline-edit, .edit-hint, .menu, [role='dialog'], .right";
const MOVE_PX = 4;

export function inCardArea(target: EventTarget | null, clientX: number, card: HTMLElement): boolean {
  if (!(target instanceof Element) || !card.contains(target)) return false;
  if (target.closest(NOT_AREA) !== null) return false;
  // The card's left padding, before the checkbox, is outside the area (spec Edge Cases). Only a click on the card
  // itself can land there; a click on its content counts whatever its coordinates (a synthetic or assistive click
  // carries none).
  if (target !== card) return true;
  const cb = card.querySelector<HTMLElement>(":scope > .cb");
  return cb === null || clientX >= cb.getBoundingClientRect().right;
}

/** Remembers where a press started, so a click that ends a moved press can be ignored (FR-024). */
export function pressTracker(): { down(e: { clientX: number; clientY: number }): void; moved(e: { clientX: number; clientY: number }): boolean } {
  let start: { x: number; y: number } | null = null;
  return {
    down(e) {
      start = { x: e.clientX, y: e.clientY };
    },
    moved(e) {
      return start !== null && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= MOVE_PX;
    },
  };
}
