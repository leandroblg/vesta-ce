/**
 * A long press on a floating-menu button (011 FR-018 for Table; 013 FR-042 for Highlight, research §15): holding
 * the primary button for LONG_PRESS_MS runs `onLong`, and the click that ends the press is swallowed. The release
 * is watched on the whole document, since it may land anywhere (013 FR-045, research §17): a release before the
 * delay cancels the press wherever it lands, and a long press released off the button sends no click to it (the
 * click goes to a common ancestor), so nothing is left to swallow and a later Enter or Space acts.
 */
import { LONG_PRESS_MS } from "../../../domain/limits";

export interface LongPress {
  /** True once for the click that ends a long press; that click must do nothing. */
  consumeClick(): boolean;
  destroy(): void;
}

/** `leaveCancels` (015 FR-007, the Reschedule buttons): leaving the button before the delay cancels the press. */
export function longPress(button: HTMLElement, onLong: () => void, ms = LONG_PRESS_MS, opts: { leaveCancels?: boolean } = {}): LongPress {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  let swallow = false;
  const doc = button.ownerDocument;
  const disarm = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    doc.removeEventListener("pointerup", release, true);
    doc.removeEventListener("pointercancel", cancelled, true);
  };
  function release(e: PointerEvent): void {
    const onButton = e.target instanceof Node && button.contains(e.target);
    disarm();
    swallow = fired && onButton;
    fired = false;
  }
  function cancelled(): void {
    disarm();
    swallow = false;
    fired = false;
  }
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    disarm();
    swallow = false;
    fired = false;
    doc.addEventListener("pointerup", release, true);
    doc.addEventListener("pointercancel", cancelled, true);
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      onLong();
    }, ms);
  };
  const leave = () => {
    if (timer !== null) cancelled();
  };
  button.addEventListener("pointerdown", down);
  if (opts.leaveCancels === true) button.addEventListener("pointerleave", leave);
  return {
    consumeClick() {
      if (!swallow) return false;
      swallow = false;
      return true;
    },
    destroy() {
      disarm();
      button.removeEventListener("pointerdown", down);
      button.removeEventListener("pointerleave", leave);
    },
  };
}
