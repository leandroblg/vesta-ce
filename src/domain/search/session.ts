// The search session's transitions (006 research §6): which reply applies, when items stay shown, and when
// "Preparing search…" shows. The renderer store holds the state and delegates every decision here.
import type { MatchInfo } from "./view";

export interface SearchSession {
  /** The seq of the latest request sent. */
  seq: number;
  /** When the latest request was sent, while it awaits a complete reply; null otherwise. */
  awaitingSince: number | null;
  matches: ReadonlyMap<string, MatchInfo>;
  /** Items created or edited during this search: shown even when they do not match (FR-009). */
  pinned: ReadonlySet<string>;
  /** "Preparing search…" (FR-023): a reply is over 300 ms late, or the index is still pending (FR-025). */
  slow: boolean;
  /**
   * A complete reply has been applied since the search began. Until then the lists stay unfiltered, so the
   * first keystroke never empties them while results are on their way (SC-001), and nothing partial shows
   * while the index is prepared (FR-025).
   */
  applied: boolean;
}

export interface ReplyLike {
  seq: number;
  pending: boolean;
  matches: readonly { kind?: string; id: string; inTitle: boolean; excerpt: string | null }[];
}

export const SLOW_MS = 300;

export const initialSession = (): SearchSession => ({
  seq: 0,
  awaitingSince: null,
  matches: new Map(),
  pinned: new Set(),
  slow: false,
  applied: false,
});

export function send(state: SearchSession, now: number): { state: SearchSession; seq: number } {
  const seq = state.seq + 1;
  return { seq, state: { ...state, seq, awaitingSince: now } };
}

/** Applies a reply only when it answers the latest request; a pending reply keeps the previous matches. */
export function applyReply(state: SearchSession, reply: ReplyLike): SearchSession {
  if (reply.seq !== state.seq) return state;
  if (reply.pending) return { ...state, slow: true };
  const matches = new Map(reply.matches.map((m) => [m.id, { inTitle: m.inTitle, excerpt: m.excerpt }]));
  return { ...state, matches, awaitingSince: null, slow: false, applied: true };
}

/** The search was cleared: results are forgotten; `seq` keeps counting so late replies are still dropped. */
export function endSearch(state: SearchSession): SearchSession {
  return { ...initialSession(), seq: state.seq };
}

export function checkSlow(state: SearchSession, now: number): SearchSession {
  if (state.slow || state.awaitingSince === null || now - state.awaitingSince < SLOW_MS) return state;
  return { ...state, slow: true };
}

/** A change of the text or of a toggle releases the items kept in view (FR-004c, FR-009). */
export function onQueryChange(state: SearchSession): SearchSession {
  return state.pinned.size === 0 ? state : { ...state, pinned: new Set() };
}

export function onEdit(state: SearchSession, id: string, active: boolean): SearchSession {
  if (!active || state.pinned.has(id)) return state;
  return { ...state, pinned: new Set([...state.pinned, id]) };
}
