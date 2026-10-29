/**
 * Closing and switching the details panel from outside it (005 FR-003, research §8): a click on another task's
 * card switches it (its title opens it after the double-click window), a click on a reminder or anywhere else
 * closes it, a click on another card's checkbox closes it and still marks that item done, and Esc closes it.
 */
import { useEffect, type RefObject } from "react";
import { actions, useVesta } from "../../store/store";
import { isClose } from "../../keyboard/registry";
import { inCardArea } from "../tasks/card-area";
import { pressStart } from "../../pointer";

// Menus, popovers and notifications sit outside the panel but do not close it. 016 FR-001 (US1 scenario 11): the
// notification slot is `.toast-root`; `.notif` never matched, so Undo on a notice used to close the panel.
const KEEPS_OPEN = ".menu, [role='dialog'], [role='toolbar'], .toast-root, .test-layer, .tbl-handles";
// Controls on a task card that do their own thing: no switch.
const CARD_CONTROLS = "button, a, .grip, .title, textarea, input:not(.cb), [contenteditable='true']";

/**
 * Whether a click leaves the panel open: it landed inside the panel or a menu, popover or dialog, or (013 FR-045,
 * PRD Q173) the press it ends began there, wherever it was released.
 */
export function keepsPanelOpen(panel: Element | null, target: Element, start: EventTarget | null): boolean {
  const inside = (node: Node) => panel?.contains(node) === true || (node instanceof Element && node.closest(KEEPS_OPEN) !== null);
  if (inside(target)) return true;
  return start instanceof Node && inside(start);
}

export type OutsideClick = { kind: "keep" } | { kind: "card" } | { kind: "switch"; id: string } | { kind: "close" } | { kind: "closeAndClear" };

/**
 * What a click does to an open panel. 018 FR-027 (PRD Q275): outside the panel and every card it closes the panel and
 * clears the selection; on a reminder card or a task's checkbox it only closes it.
 */
export function outsideClick(panel: Element | null, target: Element, start: EventTarget | null, clientX: number, panelFor: string | null): OutsideClick {
  if (keepsPanelOpen(panel, target, start)) return { kind: "keep" };
  const card = target.closest<HTMLElement>("li[data-kind]");
  if (card === null) return { kind: "closeAndClear" };
  if (card.dataset["kind"] !== "task") return { kind: "close" };
  if (target.closest("input.cb") !== null) return { kind: "close" };
  // 011 FR-022: a click in the card's area is the card's own (it opens or switches after the double-click time); a
  // click on the left padding, outside the area, switches at once as in 005 (spec Edge Cases).
  if (inCardArea(target, clientX, card)) return { kind: "card" };
  if (target.closest(CARD_CONTROLS) !== null) return { kind: "card" };
  const id = card.dataset["id"];
  return id !== undefined && id !== panelFor ? { kind: "switch", id } : { kind: "card" };
}

/**
 * `onClose` closes and gives the focus back to the card (Esc); `onCloseOutside` (018) closes after a click outside
 * every card, leaving the focus where the click put it, and clears the selection.
 */
export function useClickRules(panel: RefObject<HTMLElement | null>, onClose: () => void, onCloseOutside: () => void = onClose): void {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element) || !document.contains(target)) return;
      const out = outsideClick(panel.current, target, pressStart(), e.clientX, useVesta.getState().panelFor);
      if (out.kind === "switch") actions.openPanel(out.id);
      else if (out.kind === "close") onClose();
      else if (out.kind === "closeAndClear") onCloseOutside();
    };
    const onKey = (e: KeyboardEvent) => {
      // The Close action (Esc unless remapped, 007 FR-032).
      if (!isClose(e) || e.isComposing || e.defaultPrevented) return;
      const s = useVesta.getState();
      if (s.menuFor !== null || s.overrideFor !== null || s.editingKey !== null) return;
      onClose();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [panel, onClose, onCloseOutside]);
}
