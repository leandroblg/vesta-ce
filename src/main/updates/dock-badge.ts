/**
 * 013 FR-024 (PRD Q167, Q176; constitution V v1.1.0): on macOS the update mark also shows as a badge on the Dock
 * icon, once per newer version, and goes with the Updates tab mark. No OS notification and no sound.
 */
import type { UpdateState } from "../../shared/ipc-contract";

export interface DockLike {
  setBadge(text: string): void;
}

export function applyDockBadge(dock: DockLike | undefined, state: Pick<UpdateState, "mark">): void {
  dock?.setBadge(state.mark ? "1" : "");
}
