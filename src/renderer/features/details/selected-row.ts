import { useEffect } from "react";

/**
 * HIG identity (B · Hearth, Lists: persistent selection highlight): the open item's row carries `data-selected`
 * and aria-current. Written to the DOM here, not rendered by the card: a card that re-rendered on the panel's
 * close would reset its controlled checkbox before the browser's click toggled it (the panel closes in a click's
 * capture phase, and React flushes store updates in the microtask that follows).
 */
export function useSelectedRow(id: string): void {
  useEffect(() => {
    const li = document.querySelector<HTMLElement>(`li[data-id="${CSS.escape(id)}"]`);
    if (li === null) return;
    li.dataset["selected"] = "";
    li.setAttribute("aria-current", "true");
    return () => {
      delete li.dataset["selected"];
      li.removeAttribute("aria-current");
    };
  }, [id]);
}
