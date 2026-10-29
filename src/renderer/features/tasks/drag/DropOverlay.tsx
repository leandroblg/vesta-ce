/**
 * The drop indicator (004 FR-012): one element over `.main-inner`, drawn from the store's dropIndicator.
 * A line at the top-level or subtask indent, or an outline over a card or the whole stale group: a shape,
 * not colour alone.
 */
import { useVesta } from "../../../store/store";

export function DropOverlay() {
  const box = useVesta((s) => s.dropIndicator);
  if (box === null) return null;
  return (
    <div
      className={`drop-overlay ${box.kind}`}
      data-indicator={box.kind}
      aria-hidden="true"
      style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
    />
  );
}
