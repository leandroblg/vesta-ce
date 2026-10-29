/**
 * 015 (PRD Q207, Q220, Q221; ui.md "Durations menu"): the quick reschedule durations as one horizontal row with the
 * context menu's surface. Opened below a Reschedule button held 500 ms or given Shift+Enter (`hold`), or on the
 * context menu's left from its Postpone For item (`submenu`). Left and Right move without wrapping, Home and End
 * jump, Enter and Space are the buttons' own click; Esc closes the hold row, and goes back to Postpone For from the
 * submenu, as Right on its last item (the one next to the menu) does.
 */
import { useRef, type KeyboardEvent, type RefObject } from "react";
import { useAnchoredPosition, useOutsidePointer } from "./popover";

export interface RowItem {
  key: string;
  label: string;
  onSelect: () => void;
}

export type RowMode = "hold" | "submenu";
export type RowKeyResult = { focus: number } | { close: true } | { back: true } | null;

/** What a key does in a row of `count` items with the focus on `index` (null: leave it to the browser). */
export function rowKey(key: string, index: number, count: number, mode: RowMode): RowKeyResult {
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
      if (mode === "submenu" && index >= last) return { back: true };
      return { focus: Math.min(last, index + 1) };
    case "ArrowLeft":
      return { focus: Math.max(0, index - 1) };
    case "Home":
      return { focus: 0 };
    case "End":
      return { focus: last };
    case "ArrowUp":
    case "ArrowDown":
      return { focus: index };
    case "Escape":
      return mode === "submenu" ? { back: true } : { close: true };
    default:
      return null;
  }
}

interface Props {
  label: string;
  items: readonly RowItem[];
  anchorRef: RefObject<HTMLElement | null>;
  mode: RowMode;
  /** The hold row closed (Esc, a click outside or a choice); the focus goes back to the button unless `chose`. */
  onClose: (returnFocus: boolean) => void;
}

export function DurationsRow({ label, items, anchorRef, mode, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useAnchoredPosition(
    ref,
    anchorRef,
    () => {
      ref.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    },
    mode === "hold" ? "below-center" : "left-of-menu",
  );
  // The submenu lives inside the context menu, whose own outside-press rule covers it.
  useOutsidePointer(ref, anchorRef, () => {
    if (mode === "hold") onClose(false);
  });

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])];
    const result = rowKey(e.key, Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement)), buttons.length, mode);
    if (result === null) return;
    e.preventDefault();
    e.stopPropagation();
    if ("focus" in result) buttons[result.focus]?.focus();
    else onClose(true);
  }

  return (
    <div ref={ref} className="menu menu-row" role="menu" aria-orientation="horizontal" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            onClose(false);
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
