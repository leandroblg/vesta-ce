/**
 * 017 FR-006a (PRD Q265, constitution v1.2.0 principle II; research §11): whether this Linux system blocks the
 * unprivileged user namespaces Chromium's sandbox needs, by the probe electron-builder's AppImage launcher runs
 * (`unshare -Ur true`), so the app and the launcher agree. The one child process in src/: a fixed binary by absolute
 * path, fixed arguments, no shell, on packaged Linux builds only (security audit, 017 note on L12).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export const UNSHARE_PATHS = ["/usr/bin/unshare", "/bin/unshare"] as const;

export function userNamespacesBlocked(): boolean {
  const unshare = UNSHARE_PATHS.find((p) => existsSync(p));
  // As the launcher does: without unshare, the namespaces count as blocked.
  if (unshare === undefined) return true;
  return spawnSync(unshare, ["-Ur", "true"], { stdio: "ignore", timeout: 2000, shell: false }).status !== 0;
}
