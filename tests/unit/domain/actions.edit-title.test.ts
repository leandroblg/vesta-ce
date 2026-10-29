import { describe, expect, it } from "vitest";
import { editTitle } from "../../../src/domain/actions";
import { fixedClock } from "../../../src/domain/clock";
import { DomainError } from "../../../src/domain/task";
import { id, mk } from "./fixtures";

const clock = fixedClock(9000);

describe("editTitle (FR-017 to FR-019)", () => {
  it("updates the title and the last-edit time", () => {
    const a = mk({ titleMd: "Old", updatedAt: 100 });
    expect(editTitle(a.id, "  New\ntitle ", [a], clock)).toEqual({
      upserts: [{ ...a, titleMd: "New title", updatedAt: 9000 }],
      removals: [],
    });
  });

  it("saves nothing for an empty title or an unchanged one", () => {
    const a = mk({ titleMd: "Same" });
    expect(editTitle(a.id, "   ", [a], clock)).toEqual({ upserts: [], removals: [] });
    expect(editTitle(a.id, " Same ", [a], clock)).toEqual({ upserts: [], removals: [] });
  });

  it("rejects unknown ids and items that are not active", () => {
    expect(() => editTitle(id(999), "x", [], clock)).toThrow(DomainError);
    const done = mk({ doneAt: 1 });
    expect(() => editTitle(done.id, "x", [done], clock)).toThrow(/not active/);
  });
});
