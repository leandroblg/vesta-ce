/** True while the event comes from text being edited: an editor or a text field (004 FR-024, 007 FR-021). */
export function inEditor(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset"].includes(target.type);
  // 011: the floating menu, the color picker and the table size grid belong to the edit; their keys
  // (Shift+Enter, Delete, Alt+arrows, Enter) are theirs, never the list's shortcuts.
  return target.closest(".editing, .fmenu, .cpick, .tsize") !== null;
}

/** True for a text field that takes typing, where Cmd/Ctrl+Z is native text undo (research §10). */
export function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target.isContentEditable) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "color"].includes(target.type);
}
