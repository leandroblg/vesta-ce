import { describe, expect, it } from "vitest";

describe("editor test environment", () => {
  it("runs with a DOM", () => {
    const el = document.createElement("div");
    el.textContent = "ok";
    expect(el.outerHTML).toBe("<div>ok</div>");
  });
});
