// T027: the search session transitions the store delegates to (006 research §6; FR-004c, FR-009, FR-023, FR-025).
import { describe, expect, it } from "vitest";
import { applyReply, checkSlow, endSearch, initialSession, onEdit, onQueryChange, send, type SearchSession } from "../../../../src/domain/search/session";

const reply = (seq: number, ids: string[], pending = false) => ({
  seq,
  pending,
  matches: ids.map((id) => ({ kind: "task" as const, id, inTitle: true, excerpt: null })),
});
const ids = (s: SearchSession) => [...s.matches.keys()];

describe("search session", () => {
  it("send gives increasing seq", () => {
    let s = initialSession();
    const a = send(s, 0);
    s = a.state;
    const b = send(s, 10);
    expect([a.seq, b.seq]).toEqual([1, 2]);
  });

  it("applies only the reply to the latest request (2, 3, 1 leave the matches of 3)", () => {
    let s = initialSession();
    for (let i = 0; i < 3; i++) s = send(s, i).state;
    s = applyReply(s, reply(2, ["two"]));
    expect(ids(s)).toEqual([]);
    s = applyReply(s, reply(3, ["three"]));
    expect(ids(s)).toEqual(["three"]);
    s = applyReply(s, reply(1, ["one"]));
    expect(ids(s)).toEqual(["three"]);
  });

  it("empties pinned on a text or toggle change (FR-004c)", () => {
    let s = onEdit(initialSession(), "a", true);
    expect([...s.pinned]).toEqual(["a"]);
    s = onQueryChange(s);
    expect([...s.pinned]).toEqual([]);
  });

  it("pins an edited or created item only while the search is active (FR-009)", () => {
    expect([...onEdit(initialSession(), "a", false).pinned]).toEqual([]);
    expect([...onEdit(onEdit(initialSession(), "a", true), "b", true).pinned]).toEqual(["a", "b"]);
  });

  it("becomes slow when the latest request has had no reply for 300 ms, and not before", () => {
    let s = send(initialSession(), 1000).state;
    expect(checkSlow(s, 1299).slow).toBe(false);
    s = checkSlow(s, 1300);
    expect(s.slow).toBe(true);
    s = applyReply(s, reply(1, ["x"]));
    expect(s.slow).toBe(false);
    expect(checkSlow(s, 5000).slow).toBe(false);
  });

  it("stays slow, keeping the previous matches, while replies say the index is pending (FR-025)", () => {
    let s = send(initialSession(), 0).state;
    s = applyReply(s, reply(1, ["old"]));
    s = send(s, 10).state;
    s = applyReply(s, reply(2, ["partial"], true));
    expect(s.slow).toBe(true);
    expect(ids(s)).toEqual(["old"]);
    s = send(s, 20).state;
    s = applyReply(s, reply(3, ["complete"]));
    expect(s.slow).toBe(false);
    expect(ids(s)).toEqual(["complete"]);
  });

  it("marks results applied only after a complete reply, and forgets them when the search ends", () => {
    let s = send(initialSession(), 0).state;
    expect(s.applied).toBe(false);
    s = applyReply(s, reply(1, ["x"], true));
    expect(s.applied).toBe(false);
    s = send(s, 10).state;
    s = applyReply(s, reply(2, ["x"]));
    expect(s.applied).toBe(true);
    s = endSearch(s);
    expect(s.applied).toBe(false);
    expect(ids(s)).toEqual([]);
    expect(s.seq).toBe(2);
  });

  it("keeps each match's inTitle and excerpt", () => {
    let s = send(initialSession(), 0).state;
    s = applyReply(s, { seq: 1, pending: false, matches: [{ kind: "task", id: "t", inTitle: false, excerpt: "…2291…" }] });
    expect(s.matches.get("t")).toEqual({ inTitle: false, excerpt: "…2291…" });
  });
});
