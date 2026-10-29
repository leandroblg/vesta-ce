import { describe, expect, it } from "vitest";
import { create } from "../../../src/domain/actions";
import { fixedClock } from "../../../src/domain/clock";
import { id, idGen, mk } from "./fixtures";

const clock = fixedClock(5000);

describe("create top-level task (FR-011 to FR-013, FR-016)", () => {
  it("adds one task at the end of the active top-level list", () => {
    const a = mk({ position: 1 });
    const b = mk({ position: 3 });
    const doneOne = mk({ position: 10, doneAt: 1 });
    const cs = create({ title: "  Renew passport ", parentId: null }, [a, b, doneOne], clock, idGen());
    expect(cs.removals).toEqual([]);
    expect(cs.upserts).toEqual([
      {
        id: id(1),
        parentId: null,
        titleMd: "Renew passport",
        position: 4,
        createdAt: 5000,
        updatedAt: 5000,
        doneAt: null,
        deletedAt: null,
        collapsed: false,
        prevSiblingId: null,
        nextSiblingId: null,
        leftWithId: null,
        alertOverrideMin: null,
        staleBaseAt: 5000,
        staleSince: null,
        wasStale: false,
        lastBlinkAt: null,
        firstBlinkCount: null,
        manuallyPositioned: false,
        lastSignalAt: null,
        detailsMd: "",
        rescheduleForMin: null,
        keptDoneAt: null,
      },
    ]);
  });

  it("starts at position 1 in an empty list", () => {
    const cs = create({ title: "First", parentId: null }, [], clock, idGen());
    expect(cs.upserts[0]?.position).toBe(1);
  });

  it("creates nothing for an empty or whitespace-only title", () => {
    expect(create({ title: "", parentId: null }, [], clock, idGen())).toEqual({ upserts: [], removals: [] });
    expect(create({ title: " \n ", parentId: null }, [], clock, idGen())).toEqual({ upserts: [], removals: [] });
  });
});
