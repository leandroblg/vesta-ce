/**
 * 009: turning main's update state into at most one notification per version (FR-024, FR-024a). Pure: the
 * store passes the version it already queued this session and whether Settings is open.
 */
import type { UpdateState } from "../../shared/ipc-contract";

export function planUpdateNotice(
  next: UpdateState,
  queued: string | null,
  settingsOpen: boolean,
): { notify: string | null; queued: string | null } {
  const version = next.announce?.version ?? null;
  // Found while Settings is open: the user already sees the Updates section, so no notice (spec edge case).
  if (version === null || version === queued || settingsOpen) return { notify: null, queued };
  return { notify: version, queued: version };
}

/**
 * 010 FR-033 (Q133): the reminder waits while Settings is open (the user is where Check for updates sits) and shows
 * once Settings closes; a completed check meanwhile restarts the period, so a waiting reminder is dropped.
 */
export function planReminder(
  event: "due" | "settingsClosed" | "checked",
  state: { settingsOpen: boolean; queued: boolean },
): { show: boolean; queued: boolean } {
  switch (event) {
    case "due":
      return state.settingsOpen ? { show: false, queued: true } : { show: true, queued: false };
    case "settingsClosed":
      return { show: state.queued, queued: false };
    case "checked":
      return { show: false, queued: false };
  }
}
