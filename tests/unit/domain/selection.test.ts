import { describe, expect, it } from "vitest";
import { afterRemoval, nextCard, type CardRef } from "../../../src/domain/selection";

const card = (id: string, kind: CardRef["kind"] = "task"): CardRef => ({ id, kind });
const order = [card("r1", "rem"), card("r2", "rem"), card("t1"), card("s1"), card("s2"), card("t2")];

describe("nextCard (007 FR-025, FR-031a)", () => {
  it("starts at the first card going down and the last going up", () => {
    expect(nextCard(order, null, "next")).toEqual(card("r1", "rem"));
    expect(nextCard(order, null, "prev")).toEqual(card("t2"));
  });

  it("moves to the neighbour and stops at the ends", () => {
    expect(nextCard(order, "r2", "next")).toEqual(card("t1"));
    expect(nextCard(order, "t1", "prev")).toEqual(card("r2", "rem"));
    expect(nextCard(order, "t2", "next")).toEqual(card("t2"));
    expect(nextCard(order, "r1", "prev")).toEqual(card("r1", "rem"));
  });

  it("treats a card no longer shown as no selection", () => {
    expect(nextCard(order, "gone", "next")).toEqual(card("r1", "rem"));
  });

  it("gives nothing for an empty view", () => {
    expect(nextCard([], null, "next")).toBeNull();
  });
});

describe("afterRemoval (FR-029)", () => {
  it("gives the next card, else the previous, else the empty card", () => {
    expect(afterRemoval(order, new Set(["s1"]), "s1")).toEqual(card("s2"));
    expect(afterRemoval(order, new Set(["t2"]), "t2")).toEqual(card("s2"));
    expect(afterRemoval([card("t1")], new Set(["t1"]), "t1")).toBe("emptyCard");
  });

  it("skips every card that left with the removed one", () => {
    expect(afterRemoval(order, new Set(["t1", "s1", "s2"]), "t1")).toEqual(card("t2"));
    expect(afterRemoval(order.slice(0, 5), new Set(["t1", "s1", "s2"]), "t1")).toEqual(card("r2", "rem"));
  });
});
