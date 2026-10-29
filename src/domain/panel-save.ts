// The details panel's save state (005 data-model.md, research §8, FR-009, FR-010): a pure machine.
//   idle ──edit──▶ pending ──500 ms──▶ saving ──ok──▶ saved ──3 s──▶ idle
//                                             └─failed─▶ failed (sticky until a later save succeeds)
// The caller sends the save when an effect asks for it, and feeds the reply back.

export const DEBOUNCE_MS = 500;
export const SAVED_MS = 3000;

export type PanelSavePhase = "idle" | "pending" | "saving" | "saved" | "failed";

export interface PanelSave {
  phase: PanelSavePhase;
  /** "Changes not saved" stays until a save succeeds (FR-010). */
  failedSticky: boolean;
  /** When a pending save goes out. */
  dueAt: number | null;
  /** When "Saved" stops showing. */
  savedUntil: number | null;
  /** An edit arrived while saving: exactly one more save follows the reply. */
  queued: boolean;
  /** The panel closed: nothing more shows, and late replies are ignored. */
  closed: boolean;
}

export type PanelSaveEvent =
  | { type: "edit"; now: number }
  | { type: "timer"; now: number }
  | { type: "reply"; ok: boolean; now: number }
  | { type: "close"; now: number };

export type PanelSaveEffect = "save";

export function initialPanelSave(): PanelSave {
  return { phase: "idle", failedSticky: false, dueAt: null, savedUntil: null, queued: false, closed: false };
}

const out = (state: PanelSave, save = false) => ({ state, effects: save ? (["save"] as PanelSaveEffect[]) : [] });

export function step(s: PanelSave, e: PanelSaveEvent): { state: PanelSave; effects: PanelSaveEffect[] } {
  if (s.closed) return out(s);
  switch (e.type) {
    case "edit":
      if (s.phase === "saving") return out({ ...s, queued: true });
      return out({ ...s, phase: "pending", dueAt: e.now + DEBOUNCE_MS, savedUntil: null });
    case "timer":
      if (s.phase === "pending" && s.dueAt !== null && e.now >= s.dueAt)
        return out({ ...s, phase: "saving", dueAt: null }, true);
      if (s.phase === "saved" && s.savedUntil !== null && e.now >= s.savedUntil) {
        return out({ ...s, phase: "idle", savedUntil: null });
      }
      return out(s);
    case "reply": {
      if (s.phase !== "saving") return out(s);
      // A queued edit is saved at once; a success clears "Changes not saved", a failure sets it.
      if (s.queued) return out({ ...s, failedSticky: !e.ok, queued: false }, true);
      return e.ok
        ? out({ ...s, phase: "saved", failedSticky: false, savedUntil: e.now + SAVED_MS })
        : out({ ...s, phase: "failed", failedSticky: true });
    }
    case "close": {
      const flush = s.phase === "pending" || (s.phase === "saving" && s.queued);
      return out({ ...initialPanelSave(), closed: true }, flush);
    }
  }
}

/** When the caller must send a `timer` event next, or null. */
export function nextWakeAt(s: PanelSave): number | null {
  if (s.closed) return null;
  if (s.phase === "pending") return s.dueAt;
  if (s.phase === "saved") return s.savedUntil;
  return null;
}

/** What the panel shows. */
export function panelSaveView(s: PanelSave): { state: PanelSavePhase; failedSticky: boolean } {
  return s.closed ? { state: "idle", failedSticky: false } : { state: s.phase, failedSticky: s.failedSticky };
}
