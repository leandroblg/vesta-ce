import { describe, expect, it } from "vitest";
import { bringBack } from "../../../src/domain/placement";
import type { Task } from "../../../src/domain/task";
import { mk } from "./fixtures";

const NOW = 9999;
const get = (cs: { upserts: Task[] }, id: string) => cs.upserts.find((t) => t.id === id);

describe("bringBack placement (FR-024, FR-036, FR-037)", () => {
  it("goes right after its former previous neighbour when it is active in the same list", () => {
    const a = mk({ position: 1 });
    const c = mk({ position: 2 });
    const b = mk({ position: 5, doneAt: 1, prevSiblingId: a.id, nextSiblingId: c.id });
    const cs = bringBack(b, [a, b, c], NOW);
    expect(get(cs, b.id)).toMatchObject({ position: 1.5, doneAt: null, prevSiblingId: null, nextSiblingId: null, updatedAt: NOW });
  });

  it("otherwise goes right before its former next neighbour", () => {
    const x = mk({ position: 1 });
    const c = mk({ position: 3 });
    const gone = mk({ position: 2, deletedAt: 1 });
    const b = mk({ position: 9, doneAt: 1, prevSiblingId: gone.id, nextSiblingId: c.id });
    const cs = bringBack(b, [x, c, gone, b], NOW);
    expect(get(cs, b.id)?.position).toBe(2);
  });

  it("otherwise goes to the end of its list", () => {
    const x = mk({ position: 4 });
    const b = mk({ position: 1, doneAt: 1, prevSiblingId: "missing", nextSiblingId: null });
    expect(get(bringBack(b, [x, b], NOW), b.id)?.position).toBe(5);
  });

  it("brings back the subtasks that went with it, in their order", () => {
    const p = mk({ doneAt: 7 });
    const s2 = mk({ parentId: p.id, position: 2, doneAt: 7, leftWithId: p.id });
    const s1 = mk({ parentId: p.id, position: 1, doneAt: 7, leftWithId: p.id });
    const cs = bringBack(p, [p, s1, s2], NOW);
    expect(get(cs, s1.id)).toMatchObject({ doneAt: null, leftWithId: null, position: 1, parentId: p.id, updatedAt: NOW });
    expect(get(cs, s2.id)).toMatchObject({ doneAt: null, leftWithId: null, position: 2 });
  });

  it("a subtask whose parent is not active becomes top-level at the end", () => {
    const top = mk({ position: 3 });
    const p = mk({ position: 1, deletedAt: 1 });
    const s = mk({ parentId: p.id, position: 1, deletedAt: 1, leftWithId: p.id, prevSiblingId: top.id });
    const cs = bringBack(s, [top, p, s], NOW);
    expect(get(cs, s.id)).toMatchObject({ parentId: null, position: 4, deletedAt: null, leftWithId: null });
    const missingParent = mk({ parentId: "00000000-0000-4000-8000-0000000fffff", doneAt: 1 });
    expect(get(bringBack(missingParent, [top, missingParent], NOW), missingParent.id)).toMatchObject({ parentId: null, position: 4 });
  });

  it("expands a collapsed active parent receiving a subtask, without changing its last-edit time", () => {
    const p = mk({ collapsed: true, updatedAt: 3 });
    const s = mk({ parentId: p.id, doneAt: 1 });
    const cs = bringBack(s, [p, s], NOW);
    expect(get(cs, p.id)).toEqual({ ...p, collapsed: false, updatedAt: 3 });
  });

  it("renumbers the list when the midpoint gap is under 1e-9, without touching last-edit times", () => {
    const a = mk({ position: 1, updatedAt: 1 });
    const c = mk({ position: 1 + 1e-10, updatedAt: 1 });
    const b = mk({ position: 9, doneAt: 1, prevSiblingId: a.id });
    const cs = bringBack(b, [a, c, b], NOW);
    expect(get(cs, a.id)).toMatchObject({ position: 1, updatedAt: 1 });
    expect(get(cs, b.id)).toMatchObject({ position: 2 });
    expect(get(cs, c.id)).toMatchObject({ position: 3, updatedAt: 1 });
  });

  it("never changes the creation date", () => {
    const b = mk({ createdAt: 12, doneAt: 1 });
    expect(get(bringBack(b, [b], NOW), b.id)?.createdAt).toBe(12);
  });

  it("brings back a collapsed parent expanded when subtasks come back with it (003 FR-028a)", () => {
    const p = mk({ collapsed: true, doneAt: 5, updatedAt: 3 });
    const sub = mk({ parentId: p.id, doneAt: 5, leftWithId: p.id });
    const cs = bringBack(p, [p, sub], NOW, { expandParent: true });
    expect(get(cs, p.id)).toMatchObject({ collapsed: false, doneAt: null, updatedAt: NOW });
    expect(get(bringBack(p, [p, sub], NOW), p.id)?.collapsed).toBe(true); // undo keeps it collapsed
  });

  it("keeps a restored collapsed parent collapsed when no subtask comes back with it", () => {
    const p = mk({ collapsed: true, doneAt: 5 });
    expect(get(bringBack(p, [p], NOW, { expandParent: true }), p.id)?.collapsed).toBe(true);
  });
});
