// @vitest-environment jsdom
// Convergence T093 (010 FR-009, L1): a refused undo token yields no result and no message; a failed write is
// still a failed save. The token comes from main, so a refusal can only mean a page defect, never a lost edit.
import { beforeEach, describe, expect, it } from "vitest";
import { visible } from "../../../src/domain/notifications";
import { actions, notify, useVesta } from "../../../src/renderer/store/store";

type Outcome = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
const logged: string[] = [];

function bridge(outcome: Outcome): void {
  (window as unknown as { vesta: unknown }).vesta = {
    undo: { apply: () => Promise.resolve(outcome) },
    app: {
      logError: (entry: { context: string }) => {
        logged.push(entry.context);
        return Promise.resolve({ ok: true, value: null });
      },
    },
  };
}

describe("L1 a refused undo token (010 FR-009)", () => {
  beforeEach(() => {
    logged.length = 0;
    useVesta.setState({ notifications: { current: null, waiting: [] } });
  });

  it("L1 a refused undo token shows no notice", async () => {
    bridge({ ok: false, error: { code: "INVALID", message: "malformed token" } });
    notify({ type: "showUndo", kind: "done", token: "t".repeat(65) });
    expect(await actions.undo()).toBe(true);
    expect(visible(useVesta.getState().notifications)).toBeNull();
    expect(logged.some((c) => c.includes("INVALID"))).toBe(true); // refused, and the refusal is reported
  });

  it("L1 a failed write on undo is still a failed save", async () => {
    bridge({ ok: false, error: { code: "SAVE_FAILED", message: "disk" } });
    notify({ type: "showUndo", kind: "delete", token: "token" });
    await actions.undo();
    const shown = visible(useVesta.getState().notifications);
    expect(shown?.type === "sticky" && shown.kind === "saveFailed").toBe(true);
  });
});

describe("016 reschedule Undo and Redo in the store (FR-003, FR-004, FR-004a)", () => {
  const mutation = { upserts: [], removals: [] };
  function bridge016(apply: Outcome, redo: Outcome): { redoCalls: string[] } {
    const redoCalls: string[] = [];
    (window as unknown as { vesta: unknown }).vesta = {
      undo: {
        apply: () => Promise.resolve(apply),
        redo: (p: { token: string }) => {
          redoCalls.push(p.token);
          return Promise.resolve(redo);
        },
      },
      app: { logError: () => Promise.resolve({ ok: true, value: null }) },
      alerts: { tick: () => Promise.resolve({ ok: true, value: { upserts: [], removals: [], play: [], staleCount: 0 } }) },
    };
    return { redoCalls };
  }
  beforeEach(() => {
    useVesta.setState({ notifications: { current: null, waiting: [] } });
  });

  it("an undone reschedule shows the redo notice with the item's title", async () => {
    bridge016({ ok: true, value: { ...mutation, redoToken: "r1" } }, { ok: true, value: { ...mutation, undoToken: "u2" } });
    notify({ type: "showUndo", kind: "reschedule", token: "u1", title: "Fix bike" });
    await actions.undo();
    expect(visible(useVesta.getState().notifications)).toMatchObject({ type: "redo", token: "r1", title: "Fix bike" });
  });

  it("Redo calls undo:redo with the visible token and shows the undo notice again", async () => {
    const { redoCalls } = bridge016({ ok: true, value: mutation }, { ok: true, value: { ...mutation, undoToken: "u2" } });
    notify({ type: "showRedo", token: "r1", title: "Fix bike" });
    expect(await actions.redo()).toBe(true);
    expect(redoCalls).toEqual(["r1"]);
    expect(visible(useVesta.getState().notifications)).toMatchObject({ type: "undo", kind: "reschedule", token: "u2", title: "Fix bike" });
  });

  it("Redo with no redo notice does nothing", async () => {
    const { redoCalls } = bridge016({ ok: true, value: mutation }, { ok: true, value: { ...mutation, undoToken: "u2" } });
    expect(await actions.redo()).toBe(false);
    expect(redoCalls).toEqual([]);
  });

  it("a failed save on Redo shows Changes are not saved", async () => {
    bridge016({ ok: true, value: mutation }, { ok: false, error: { code: "SAVE_FAILED", message: "disk" } });
    notify({ type: "showRedo", token: "r1", title: "Fix bike" });
    await actions.redo();
    const shown = visible(useVesta.getState().notifications);
    expect(shown?.type === "sticky" && shown.kind === "saveFailed").toBe(true);
  });
});
