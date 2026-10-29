// @vitest-environment jsdom
// 011 FR-022 to FR-024: the card click area, as `inCardArea` decides it.
import { describe, expect, it } from "vitest";
import { inCardArea } from "../../../src/renderer/features/tasks/card-area";

function card(): { li: HTMLLIElement; title: HTMLElement; link: HTMLElement; grip: HTMLElement } {
  const li = document.createElement("li");
  li.innerHTML = '<input type="checkbox" class="cb"><div class="title"><a href="https://example.com">x</a> text</div><span class="grip"></span>';
  document.body.append(li);
  const cb = li.querySelector<HTMLElement>(".cb");
  if (cb === null) throw new Error("no checkbox");
  cb.getBoundingClientRect = () => ({ left: 10, right: 30, top: 0, bottom: 20, width: 20, height: 20, x: 10, y: 0, toJSON: () => ({}) });
  const get = (s: string) => li.querySelector<HTMLElement>(s) as HTMLElement;
  return { li, title: get(".title"), link: get("a"), grip: get(".grip") };
}

describe("FR-022 card click area", () => {
  it("FR-022 a click on the title counts even with no coordinates (synthetic or assistive clicks)", () => {
    const { li, title } = card();
    expect(inCardArea(title, 0, li)).toBe(true);
  });

  it("FR-022 a click on the card's own left padding, before the checkbox, is outside; after it, inside", () => {
    const { li } = card();
    expect(inCardArea(li, 5, li)).toBe(false);
    expect(inCardArea(li, 40, li)).toBe(true);
  });

  it("FR-024 the grip keeps its own behavior; a link is left to Markdown, so its double click edits the title", () => {
    const { li, link, grip } = card();
    expect(inCardArea(grip, 200, li)).toBe(false);
    expect(inCardArea(link, 50, li)).toBe(true);
  });
});
