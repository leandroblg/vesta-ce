// @vitest-environment jsdom
// 011 FR-009 (research §10): spans are painted readable for the theme; the stored colors never change.
import { describe, expect, it } from "vitest";
import { applyRendered } from "../../../src/renderer/markdown/render";
import { paintAll, paintSpan } from "../../../src/renderer/markdown/paint";

const hexOf = (css: string): string => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  if (!m) return css;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
};

function span(attrs: Record<string, string>): HTMLElement {
  const el = document.createElement("span");
  el.dataset.vestaSpan = "";
  for (const [k, v] of Object.entries(attrs)) el.dataset[k] = v;
  el.textContent = "text";
  document.body.append(el);
  return el;
}

describe("FR-009 painting spans", () => {
  it("FR-009 gray 100 text is painted adjusted in light and as chosen in dark", () => {
    const el = span({ color: "#f3f4f6ff" });
    paintSpan(el, "light");
    expect(hexOf(el.style.color)).not.toBe("#f3f4f6");
    paintSpan(el, "dark");
    expect(hexOf(el.style.color)).toBe("#f3f4f6");
    expect(el.dataset.color).toBe("#f3f4f6ff");
  });

  it("FR-009 a gray 800 highlight is painted lighter in dark and as chosen in light, with its text judged against the drawn fill", () => {
    const el = span({ bg: "#1f2937ff" });
    paintSpan(el, "light");
    expect(hexOf(el.style.backgroundColor)).toBe("#1f2937");
    expect(hexOf(el.style.color)).toBe("#ede7de"); // Automatic text on a dark fill takes the dark theme's text color (Hearth)
    paintSpan(el, "dark");
    expect(hexOf(el.style.backgroundColor)).not.toBe("#1f2937");
    expect(el.dataset.bg).toBe("#1f2937ff");
  });

  it("FR-009 paintAll repaints after a theme change; colors go through the CSSOM, never a style attribute in the markup", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span data-vesta-span="" data-color="#f3f4f6ff">x</span>';
    document.body.append(root);
    applyRendered(root);
    const el = root.querySelector<HTMLElement>("[data-vesta-span]");
    const lightColor = el?.style.color;
    paintAll(root, "dark");
    expect(el?.style.color).not.toBe(lightColor);
    expect(root.innerHTML).toContain('data-color="#f3f4f6ff"');
  });
});
