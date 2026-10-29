/**
 * Announcing a newer Vesta (009 FR-024, FR-024a, research §10): a notice and a cogwheel mark, at most once per
 * version across restarts; found while Settings is open, it is stored as already seen. Pure.
 */
import type { UpdateNotice } from "../settings";
import { compareVersions, parseVersion } from "./version";

const newer = (a: string, b: string): boolean => {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  return va !== null && vb !== null && compareVersions(va, vb) > 0;
};

export function decideAnnouncement(
  stored: UpdateNotice | null,
  found: string,
  running: string,
  /** 013 FR-024: the Updates pane is shown, so a version found now counts as seen. */
  updatesShown: boolean,
): { notify: boolean; store: UpdateNotice | null } {
  if (!newer(found, running)) return { notify: false, store: null };
  if (stored !== null && !newer(found, stored.version)) return { notify: false, store: null };
  return updatesShown ? { notify: false, store: { version: found, seen: true } } : { notify: true, store: { version: found, seen: false } };
}

export function markShows(stored: UpdateNotice | null, running: string): boolean {
  return stored !== null && !stored.seen && newer(stored.version, running);
}
