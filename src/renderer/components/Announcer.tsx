/**
 * The polite live region for move results (004 FR-027): "Fix bike, moved to position 3 of 7". The text is
 * keyed by its sequence number, so the same text after a second move is announced again.
 */
import { t } from "../i18n/t";
import { useVesta } from "../store/store";
import { useComboLabel } from "../keyboard/hint";

export function Announcer() {
  const announcement = useVesta((s) => s.announcement);
  // 007 FR-037: the card description names the current move, promote and demote combinations.
  const moves = {
    up: useComboLabel("moveUp", "spoken"),
    down: useComboLabel("moveDown", "spoken"),
    left: useComboLabel("promote", "spoken"),
    right: useComboLabel("demote", "spoken"),
  };
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement !== null && <span key={announcement.seq}>{announcement.text}</span>}
      </div>
      {/* The shared descriptions of every card (004 FR-030). */}
      <span id="drag-handle-hint" className="sr-only">
        {t("drag")}
      </span>
      <span id="drag-hint" className="sr-only">
        {t("dragHint", moves)}
      </span>
    </>
  );
}
