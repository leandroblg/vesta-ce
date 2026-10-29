/**
 * Card context menu (FR-009): Add subtask (top-level only), Details (inert, FR-010), Delete.
 * Keyboard menu pattern: arrows move, Esc or a click outside closes and returns focus to the button.
 * 015 FR-010, FR-010b (PRD Q220): an item with a `submenu` opens it as a horizontal row on the menu's left, level with
 * the item, on hover, a click, Left, Enter or Space; the row's own keys bring the focus back to the item.
 */
import { useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { DurationsRow, type RowItem } from "./DurationsRow";
import { SubMark } from "./icons";
import { useAnchoredPosition, useOutsidePointer } from "./popover";

export interface MenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
  /** 015: the row this item opens (Postpone For's quick durations); `onSelect` is not used then. */
  submenu?: readonly RowItem[];
}

interface Props {
  label: string;
  items: readonly MenuItem[];
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** 016 FR-016: `at-point` opens at the anchor's top-left (the pointer), as the link context menu does. */
  placement?: "below-right" | "at-point";
}

/** The menu's own items, not those of an open submenu row. */
const OWN_ITEMS = ":scope > div > [role='menuitem']";

export function ContextMenu({ label, items, anchorRef, onClose, placement = "below-right" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const subAnchor = useRef<HTMLButtonElement | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);

  useAnchoredPosition(
    ref,
    anchorRef,
    () => {
      ref.current?.querySelector<HTMLButtonElement>(OWN_ITEMS)?.focus();
    },
    placement,
  );
  useOutsidePointer(ref, anchorRef, onClose);

  function close(returnFocus: boolean) {
    onClose();
    if (returnFocus) anchorRef.current?.focus();
  }

  function openSubmenu(key: string, button: HTMLButtonElement) {
    subAnchor.current = button;
    setOpenSub(key);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>(OWN_ITEMS) ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (k: number) => buttons[(k + buttons.length) % buttons.length]?.focus();
    const focused = i >= 0 ? items[i] : undefined;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setOpenSub(null);
        focusAt(i + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        setOpenSub(null);
        focusAt(i - 1);
        break;
      case "Home":
        e.preventDefault();
        setOpenSub(null);
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        setOpenSub(null);
        focusAt(buttons.length - 1);
        break;
      case "ArrowLeft":
        if (focused?.submenu !== undefined && buttons[i] !== undefined) {
          e.preventDefault();
          openSubmenu(focused.key, buttons[i]);
        }
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  }

  return (
    <div ref={ref} className="menu" role="menu" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const sub = item.submenu;
        return (
          <div key={item.key} role="none">
            {item.separatorBefore === true && <div className="msep" role="separator" />}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={[item.danger === true ? "danger" : "", sub !== undefined ? "has-sub" : ""].filter(Boolean).join(" ") || undefined}
              aria-haspopup={sub !== undefined ? "menu" : undefined}
              aria-expanded={sub !== undefined ? openSub === item.key : undefined}
              onMouseEnter={(e) => {
                if (sub !== undefined) openSubmenu(item.key, e.currentTarget);
                else setOpenSub(null);
              }}
              onClick={(e) => {
                if (sub !== undefined) {
                  openSubmenu(item.key, e.currentTarget);
                  return;
                }
                close(false);
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
              {sub !== undefined && <SubMark />}
            </button>
            {sub !== undefined && openSub === item.key && (
              <DurationsRow
                label={item.label}
                mode="submenu"
                anchorRef={subAnchor}
                items={sub.map((s) => ({
                  ...s,
                  onSelect: () => {
                    close(false);
                    s.onSelect();
                  },
                }))}
                onClose={(back) => {
                  setOpenSub(null);
                  if (back) subAnchor.current?.focus();
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
