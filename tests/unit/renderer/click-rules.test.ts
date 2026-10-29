// @vitest-environment jsdom
// 013 T067 (FR-045, PRD Q173, research §17): the release of a press that began inside never closes the panel.
import { describe, expect, it } from "vitest";
import { keepsPanelOpen, outsideClick } from "../../../src/renderer/features/details/useClickRules";
import { pressStart } from "../../../src/renderer/pointer";

function layout() {
  document.body.innerHTML = '<aside id="panel"><button id="table">Table</button></aside><div role="toolbar"><button id="tb">B</button></div><ul><li id="card">Card</li></ul>';
  const get = (id: string) => document.getElementById(id) as HTMLElement;
  return { panel: get("panel"), table: get("table"), tb: get("tb"), card: get("card") };
}

describe("013 FR-045 the details panel's click rule", () => {
  it("a press on a panel button released over the list (click on body) keeps the panel open", () => {
    const { panel, table } = layout();
    expect(keepsPanelOpen(panel, document.body, table)).toBe(true);
  });

  it("the same for a press that began inside a toolbar or a dialog", () => {
    const { panel, tb } = layout();
    expect(keepsPanelOpen(panel, document.body, tb)).toBe(true);
  });

  it("a press and a click both outside still close it; a keyboard click has no press", () => {
    const { panel, card } = layout();
    expect(keepsPanelOpen(panel, card, card)).toBe(false);
    expect(keepsPanelOpen(panel, card, null)).toBe(false);
  });

  it("pressStart is the primary press's target until its click has been handled", async () => {
    const { table, card } = layout();
    table.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
    expect(pressStart()).toBe(table);
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(pressStart()).toBeNull();
    card.dispatchEvent(new PointerEvent("pointerdown", { button: 2, bubbles: true }));
    expect(pressStart()).toBeNull();
  });
});

describe("016 US1 scenario 11 a click on a notification leaves the panel open", () => {
  it("keeps the panel open for a click on the bottom-center notice, its Undo or Redo button included", () => {
    const panel = document.body.appendChild(document.createElement("aside"));
    const root = document.body.appendChild(document.createElement("div"));
    root.className = "toast-root";
    const undo = root.appendChild(document.createElement("button"));
    expect(keepsPanelOpen(panel, undo, undo)).toBe(true);
    expect(keepsPanelOpen(panel, document.body, document.body)).toBe(false);
  });
});

describe("018 FR-027 a click outside the panel and every card also clears the selection (PRD Q275)", () => {
  function page() {
    document.body.innerHTML = `
      <header><input id="search"><span id="brand">Vesta</span></header>
      <main><h1 id="view-h">Tasks</h1>
        <ul data-list="tasks"><li id="t1" data-kind="task" data-id="a"><input class="cb" id="cb" type="checkbox"><button id="more">…</button></li></ul>
        <ul data-list="rem"><li id="r1" data-kind="rem" data-id="r"><span id="rtext">R</span></li></ul>
        <div id="empty"></div>
      </main>
      <aside id="panel"><p id="inside">x</p></aside>
      <div class="menu" role="menu"><button id="mi">Item</button></div>
      <div role="dialog"><button id="dlg">OK</button></div>
      <div class="toast-root"><button id="undo">Undo</button></div>`;
    return (id: string) => document.getElementById(id) as HTMLElement;
  }

  it("empty list space, the view heading, the toolbar and the search box close and clear", () => {
    const get = page();
    for (const id of ["empty", "view-h", "brand", "search"]) expect(outsideClick(get("panel"), get(id), null, 0, "a"), id).toEqual({ kind: "closeAndClear" });
  });

  it("a reminder card or a task's checkbox closes without clearing; a task control is the card's own", () => {
    const get = page();
    expect(outsideClick(get("panel"), get("rtext"), null, 0, "a")).toEqual({ kind: "close" });
    expect(outsideClick(get("panel"), get("cb"), null, 0, "a")).toEqual({ kind: "close" });
    expect(outsideClick(get("panel"), get("more"), null, 0, "a")).toEqual({ kind: "card" });
  });

  it("the panel, a menu, a dialog and the notification change nothing", () => {
    const get = page();
    for (const id of ["inside", "mi", "dlg", "undo"]) expect(outsideClick(get("panel"), get(id), null, 0, "a"), id).toEqual({ kind: "keep" });
  });
});
