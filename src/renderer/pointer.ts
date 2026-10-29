/**
 * Closing an inline editor removes its hint line, so the cards below move up. When the editor closes
 * because the pointer went down elsewhere, closing it before the pointer is released would move the
 * click's target out from under it and lose the click (a checkbox or button below the editor). Editors
 * save at once but close only after the pointer is released (001 edge case; 002 US3 scenario 5).
 */
let pressed = false;
/**
 * 013 FR-045 (PRD Q173, research §17): where the last primary press began. When press and release land on
 * different elements, the browser sends the click to their common ancestor, so a click rule must look here to
 * know the press began inside. Kept until that click has been handled.
 */
let pressTarget: EventTarget | null = null;

window.addEventListener("pointerdown", (e) => {
  pressed = true;
  if (e.button === 0) pressTarget = e.target;
}, true);
window.addEventListener("click", () => {
  setTimeout(() => {
    if (!pressed) pressTarget = null;
  }, 0);
});

/** The target of the primary press that the click being handled ends, or null for a keyboard click. */
export function pressStart(): EventTarget | null {
  return pressTarget;
}
window.addEventListener("pointerup", () => { pressed = false; }, true);
window.addEventListener("pointercancel", () => { pressed = false; }, true);

/** Runs `fn` now, or after the click that is in progress has been delivered. */
export function afterPointerRelease(fn: () => void): void {
  if (!pressed) {
    fn();
    return;
  }
  // The click event follows pointerup in the same dispatch; a task runs after it.
  window.addEventListener(
    "pointerup",
    () => {
      setTimeout(fn, 0);
    },
    { once: true },
  );
}
