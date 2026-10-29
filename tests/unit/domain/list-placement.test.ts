import { describe, expect, it } from "vitest";
import { neighboursOf, placeIndex, placePosition, positionAt, type Placeable } from "../../../src/domain/list-placement";

let n = 0;
function item(position: number, overrides: Partial<Placeable> = {}): Placeable {
  n += 1;
  return { id: `i${String(n)}`, position, prevSiblingId: null, nextSiblingId: null, ...overrides };
}

describe("neighboursOf (FR-013, 001 FR-024)", () => {
  it("returns the items just before and just after in an ordered list", () => {
    const [a, b, c] = [item(1), item(2), item(3)];
    expect(neighboursOf([a, b, c], b.id)).toEqual({ prevSiblingId: a.id, nextSiblingId: c.id });
  });

  it("returns null at either end and for a single item", () => {
    const [a, b] = [item(1), item(2)];
    expect(neighboursOf([a, b], a.id)).toEqual({ prevSiblingId: null, nextSiblingId: b.id });
    expect(neighboursOf([a, b], b.id)).toEqual({ prevSiblingId: a.id, nextSiblingId: null });
    expect(neighboursOf([a], a.id)).toEqual({ prevSiblingId: null, nextSiblingId: null });
  });
});

describe("placeIndex (FR-017, 001 FR-036)", () => {
  it("goes right after the former previous neighbour when present", () => {
    const [a, c] = [item(1), item(2)];
    expect(placeIndex(item(9, { prevSiblingId: a.id, nextSiblingId: c.id }), [a, c])).toBe(1);
  });

  it("otherwise goes right before the former next neighbour", () => {
    const [x, c] = [item(1), item(3)];
    expect(placeIndex(item(9, { prevSiblingId: "gone", nextSiblingId: c.id }), [x, c])).toBe(1);
  });

  it("otherwise goes to the end", () => {
    const [x, y] = [item(1), item(2)];
    expect(placeIndex(item(9, { prevSiblingId: "gone", nextSiblingId: "gone too" }), [x, y])).toBe(2);
    expect(placeIndex(item(9), [])).toBe(0);
  });
});

describe("placePosition (research §3, 001 research §4)", () => {
  it("takes the midpoint between its new neighbours", () => {
    const [a, c] = [item(1), item(2)];
    expect(placePosition(item(9, { prevSiblingId: a.id }), [a, c])).toEqual({ position: 1.5, renumbered: null });
  });

  it("takes the end position when it lands last, and 1 in an empty list", () => {
    const [a, b] = [item(1), item(4)];
    expect(placePosition(item(9, { prevSiblingId: b.id }), [a, b])).toEqual({ position: 5, renumbered: null });
    expect(placePosition(item(9), [])).toEqual({ position: 1, renumbered: null });
  });

  it("takes a position before the first item when its next neighbour is first", () => {
    const [a, b] = [item(3), item(4)];
    expect(placePosition(item(9, { nextSiblingId: a.id }), [a, b])).toEqual({ position: 2, renumbered: null });
  });

  it("renumbers the whole list 1, 2, 3… when the gap is under 1e-9", () => {
    const a = item(1);
    const b = item(1 + 1e-10);
    const moved = item(9, { prevSiblingId: a.id });
    const result = placePosition(moved, [a, b]);
    expect(result.position).toBe(2);
    expect(result.renumbered).toEqual(new Map([[a.id, 1], [moved.id, 2], [b.id, 3]]));
  });
});

describe("positionAt (004 research §3): positions for ids inserted at an index", () => {
  it("gives the midpoint between neighbours, before the first, after the last, and 1 in an empty list", () => {
    const [a, b] = [item(1), item(2)];
    expect(positionAt([a, b], 0, ["x"]).positions.get("x")).toBe(0);
    expect(positionAt([a, b], 1, ["x"]).positions.get("x")).toBe(1.5);
    expect(positionAt([a, b], 2, ["x"]).positions.get("x")).toBe(3);
    expect(positionAt([], 0, ["x"]).positions.get("x")).toBe(1);
    expect(positionAt([a, b], 1, ["x"]).renumbered).toBeNull();
  });

  it("places several ids consecutively, in order, inside the gap (carried subtasks, FR-008)", () => {
    const [a, b] = [item(1), item(2)];
    const mid = positionAt([a, b], 1, ["x", "y", "z"]).positions;
    expect([mid.get("x"), mid.get("y"), mid.get("z")]).toEqual([1.25, 1.5, 1.75]);
    const end = positionAt([a, b], 2, ["x", "y"]).positions;
    expect([end.get("x"), end.get("y")]).toEqual([3, 4]);
    const start = positionAt([a, b], 0, ["x", "y"]).positions;
    expect([start.get("x"), start.get("y")]).toEqual([-1, 0]);
  });

  it("renumbers the siblings and the ids 1, 2, 3… in their final order when the gap is under 1e-9", () => {
    const [a, b] = [item(1), item(1 + 5e-10)];
    const placed = positionAt([a, b], 1, ["x"]);
    expect(placed.renumbered).toEqual(new Map([[a.id, 1], ["x", 2], [b.id, 3]]));
    expect(placed.positions.get("x")).toBe(2);
  });
});
