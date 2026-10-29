// T035 (009 FR-014, FR-018; analysis M5): entries added on top keep the rows in view in place when scrolled down.
import { describe, expect, it } from "vitest";
import { addedOnTop, scrollAfterAddingOnTop } from "../../../src/renderer/features/settings/log-rows";

describe("the log list's top insertion", () => {
  it("counts the rows added in front of the previous first row", () => {
    expect(addedOnTop("a", ["x", "y", "a", "b"])).toBe(2);
    expect(addedOnTop("a", ["a", "b"])).toBe(0);
    expect(addedOnTop(null, ["a"])).toBe(0);
    expect(addedOnTop("gone", ["x", "y"])).toBe(0); // a reload, not an insertion
  });

  it("moves the offset down by the added rows' height when scrolled down, so the first visible row stays put", () => {
    expect(scrollAfterAddingOnTop(500, 2, [20, 40, 22, 22])).toBe(560);
  });

  it("leaves the view at the top, so new rows show at once", () => {
    expect(scrollAfterAddingOnTop(0, 3, [20, 20, 20])).toBe(0);
  });

  it("changes nothing when nothing was added", () => {
    expect(scrollAfterAddingOnTop(300, 0, [20])).toBe(300);
  });
});
