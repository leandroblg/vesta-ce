/**
 * Alert override panel (003 FR-034 to FR-038): opens in place of the context menu, at the same spot and styled
 * like it. Every valid change applies at once; there is no Save or Cancel. Esc or a click outside closes it.
 * The fields are AlertOverrideFields, which the details panel embeds too (005 FR-007).
 */
import { useCallback, useRef, type KeyboardEvent, type RefObject } from "react";
import type { Task } from "../../../domain/task";
import { useAnchoredPosition, useOutsidePointer } from "../../components/popover";
import { t } from "../../i18n/t";
import { actions } from "../../store/store";
import { AlertOverrideFields } from "./AlertOverrideFields";

interface Props {
  task: Task;
  anchorRef: RefObject<HTMLButtonElement | null>;
}

export function AlertOverridePanel({ task, anchorRef }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    actions.openOverride(null);
  }, []);
  useAnchoredPosition(ref, anchorRef, () => {
    ref.current?.querySelector<HTMLInputElement>("input[type='checkbox']")?.focus();
  });
  useOutsidePointer(ref, anchorRef, close);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
    anchorRef.current?.focus();
  }

  const id = `ov-${task.id}`;
  return (
    <div ref={ref} className="menu ovmodal" role="dialog" aria-labelledby={`${id}-h`} onKeyDown={onKeyDown}>
      <div className="ov-h" id={`${id}-h`}>
        {t("alertOv")}
      </div>
      <AlertOverrideFields task={task} legend={t("ovLegend")} legendClassName="ov-legend" />
    </div>
  );
}
