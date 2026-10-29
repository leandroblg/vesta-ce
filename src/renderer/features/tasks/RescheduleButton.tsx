/**
 * 015 FR-006, FR-006a, FR-007, FR-011 (PRD Q207, Q209, Q220, Q222): a Reschedule button, on the card or in the
 * details panel. A click (Enter, Space) reschedules by the tolerance; holding it 500 ms, or Shift+Enter, opens the
 * quick durations as a row below the button, centered under it. Leaving the button before the delay cancels the hold.
 */
import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { formatDuration } from "../../../domain/age";
import { quickDurations } from "../../../domain/alert-settings";
import { DurationsRow, type RowItem } from "../../components/DurationsRow";
import { longPress, type LongPress } from "../../editor/menu/long-press";
import { ageUnits, t } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";

/** The four quick durations as row items that reschedule `taskId` for each. */
export function postponeItems(taskId: string, durations: readonly number[]): RowItem[] {
  return durations.map((min, i) => ({
    key: `p${String(i)}`,
    label: formatDuration(min, ageUnits()),
    onSelect: () => void actions.reschedule(taskId, min),
  }));
}

interface Props {
  taskId: string;
  className: string;
  /** The accessible name and tooltip of an icon-only button; a button with visible text leaves it out. */
  label?: string;
  /** The row opened or closed (the card keeps its buttons shown while it is open). */
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export function RescheduleButton({ taskId, className, label, onOpenChange, children }: Props) {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const press = useRef<LongPress | null>(null);
  const [open, setOpenState] = useState(false);
  const settings = useVesta((s) => s.alertSettings);
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  /** Callback ref: the hold is attached whenever the button mounts (it comes and goes with the stale state). */
  const attach = useCallback(
    (el: HTMLButtonElement | null) => {
      press.current?.destroy();
      press.current = null;
      anchor.current = el;
      if (el !== null)
        press.current = longPress(
          el,
          () => {
            setOpen(true);
          },
          undefined,
          { leaveCancels: true },
        );
    },
    [setOpen],
  );

  const onClick = () => {
    if (press.current?.consumeClick() === true) return;
    void actions.reschedule(taskId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    }
  };

  return (
    <>
      <button
        ref={attach}
        type="button"
        className={className}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        {children}
      </button>
      {open && (
        <DurationsRow
          label={t("menuPostponeFor")}
          mode="hold"
          anchorRef={anchor}
          items={postponeItems(taskId, quickDurations(settings))}
          onClose={(returnFocus) => {
            setOpen(false);
            if (returnFocus) anchor.current?.focus();
          }}
        />
      )}
    </>
  );
}
