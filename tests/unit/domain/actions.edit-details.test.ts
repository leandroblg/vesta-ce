import { describe, expect, it } from "vitest";
import { editDetails, markDone, remove, restore } from "../../../src/domain/actions";
import { fixedClock } from "../../../src/domain/clock";
import { DomainError, type ChangeSet, type Task } from "../../../src/domain/task";
import { applyUndo, beforeOf } from "../../../src/domain/undo";
import { id, mk } from "./fixtures";

const clock = fixedClock(9000);

function apply(rows: Task[], cs: ChangeSet): Task[] {
  const map = new Map(rows.map((r) => [r.id, r]));
  for (const u of cs.upserts) map.set(u.id, u);
  for (const removed of cs.removals) map.delete(removed);
  return [...map.values()];
}

describe("editDetails (005 FR-009, FR-012)", () => {
  it("saves new details with updatedAt = now, keeping createdAt and the alert base", () => {
    const a = mk({ detailsMd: "", createdAt: 10, updatedAt: 100, staleBaseAt: 10, staleSince: 50 });
    expect(editDetails(a.id, "# Notes\n\n- [ ] one", [a], clock)).toEqual({
      upserts: [{ ...a, detailsMd: "# Notes\n\n- [ ] one", updatedAt: 9000 }],
      removals: [],
    });
  });

  it("keeps the text exactly as the editor wrote it", () => {
    const a = mk({ detailsMd: "" });
    expect(editDetails(a.id, "  trailing  \n\n", [a], clock).upserts[0]?.detailsMd).toBe("  trailing  \n\n");
  });

  it("saves nothing for unchanged details", () => {
    const a = mk({ detailsMd: "same" });
    expect(editDetails(a.id, "same", [a], clock)).toEqual({ upserts: [], removals: [] });
  });

  it("refuses an unknown or inactive task", () => {
    expect(() => editDetails(id(999), "x", [], clock)).toThrow(DomainError);
    const done = mk({ doneAt: 1 });
    expect(() => editDetails(done.id, "x", [done], clock)).toThrow(/not active/);
    const deleted = mk({ deletedAt: 1 });
    expect(() => editDetails(deleted.id, "x", [deleted], clock)).toThrow(/not active/);
  });

  it.each([
    ["done", markDone],
    ["delete", remove],
  ] as const)("details survive %s, restore and undo", (kind, action) => {
    const a = mk({ detailsMd: "kept\n\n- [x] item" });
    const rows = [a];
    const left = action(a.id, rows, fixedClock(100));
    const after = apply(rows, left);
    expect(after[0]?.detailsMd).toBe(a.detailsMd);
    const undone = apply(after, applyUndo({ kind, before: beforeOf(rows, left) }, after, fixedClock(200)));
    expect(undone[0]?.detailsMd).toBe(a.detailsMd);
    const back = apply(after, restore(a.id, after, fixedClock(300)));
    expect(back[0]?.detailsMd).toBe(a.detailsMd);
  });
});
