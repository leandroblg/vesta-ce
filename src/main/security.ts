/** Renderer hardening (PRD B1, constitution II, research.md §9). */
import type { Session, WebContents, WebFrameMain } from "electron";
import { APP_ORIGIN } from "./app-files";
import { DEV_CSP } from "./csp";
import { hostOnly } from "../domain/logs/redact";
import type { RepoRef } from "../domain/updates/releases";
import { log } from "./log";

export { PRODUCTION_CSP } from "./csp";

interface SecurityOptions {
  isPackaged: boolean;
  /** Vite dev server origin, allowed only in unpackaged builds. */
  devOrigin: string | null;
  /** 009: the repository whose release list the update check reads (FR-022). */
  repo?: RepoRef;
}

const PLAYER_ORIGIN = "https://www.youtube-nocookie.com";

/**
 * Constitution I, 009 FR-022: the one allow-list. No network except the YouTube player of an embed (005 FR-036)
 * with what it loads from inside its own frame, and the Vesta repository's release list on the GitHub API.
 */
export function networkAllowed(url: string, frameUrl: string | null, repo?: RepoRef): boolean {
  if (!/^(https?|wss?):/i.test(url)) return true;
  const isPlayer = (u: string) => u === PLAYER_ORIGIN || u.startsWith(`${PLAYER_ORIGIN}/`);
  if (repo !== undefined && isReleaseList(url, repo)) return true;
  return isPlayer(url) || (frameUrl !== null && isPlayer(frameUrl));
}

/** Exactly https://api.github.com/repos/{owner}/{repo}/releases, with or without a query (FR-022). */
function isReleaseList(url: string, repo: RepoRef): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const path = `/repos/${repo.owner}/${repo.repo}/releases`.toLowerCase();
  return u.protocol === "https:" && u.host === "api.github.com" && u.username === "" && u.password === "" && u.pathname.toLowerCase() === path;
}

/**
 * 010 FR-019 (L4, L13): a call is handled only from the main window's main frame, whose origin is exactly the app's
 * (or the development server's in unpackaged runs started with one). Node parses `app:` as a non-special scheme, so
 * the origin is built from protocol and host rather than read from `URL.origin`.
 */
export function isTrustedSender(
  frame: Pick<WebFrameMain, "url"> | null | undefined,
  mainFrame: Pick<WebFrameMain, "url"> | null,
  devOrigin: string | null,
): boolean {
  if (frame === null || frame === undefined || mainFrame === null || frame !== mainFrame) return false;
  let parsed: URL;
  try {
    parsed = new URL(frame.url);
  } catch {
    return false;
  }
  const origin = `${parsed.protocol}//${parsed.host}`;
  return origin === APP_ORIGIN || (devOrigin !== null && origin === devOrigin);
}

/** 010 FR-016 (L3): a subframe may stay on the player origin; the main frame never navigates (constitution II). */
export function frameNavigationAllowed(url: string, isMainFrame: boolean): boolean {
  if (isMainFrame) return false;
  return url === PLAYER_ORIGIN || url.startsWith(`${PLAYER_ORIGIN}/`);
}

/** 010 FR-017 (I4): the player's cookies, storage and cache, cleared at quit and at start. */
export function clearPlayerStorage(session: Pick<Session, "clearStorageData">): Promise<void> {
  return session.clearStorageData({ origin: PLAYER_ORIGIN });
}

export function applySessionSecurity(session: Session, { isPackaged, devOrigin, repo }: SecurityOptions): void {
  // 010 FR-020 (L6): the development server's documents get the development policy as a header; built pages carry
  // the production policy from the app scheme handler and their meta tag.
  if (!isPackaged && devOrigin !== null) {
    const policy = DEV_CSP(devOrigin);
    session.webRequest.onHeadersReceived((details, callback) => {
      const isDocument = details.resourceType === "mainFrame" || details.resourceType === "subFrame";
      if (isDocument && details.url.startsWith(devOrigin)) {
        callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [policy] } });
        return;
      }
      callback({});
    });
  }
  session.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const allowedDev =
      !isPackaged &&
      devOrigin !== null &&
      (url.startsWith(devOrigin) || url.startsWith(devOrigin.replace(/^http/, "ws")));
    if (!networkAllowed(url, details.frame?.url ?? null, repo) && !allowedDev) {
      // 009 FR-003, FR-022c: scheme and host only; a blocked address may come from the user's own content.
      log.warn("network.blocked", { ...hostOnly(url) });
      callback({ cancel: true });
      return;
    }
    callback({});
  });

  // No spell-check dictionary downloads from Google's CDN (constitution I, research.md §9).
  session.setSpellCheckerEnabled(false);

  // Web notifications, media, geolocation…: all refused (FR-030).
  session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
}

export function applyContentsSecurity(contents: WebContents, _options: SecurityOptions): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  // 010 FR-016 (L3): the request filter alone lets a subframe navigate while its URL still reads as the player.
  contents.on("will-frame-navigate", (event) => {
    const url = event.url;
    if (frameNavigationAllowed(url, event.isMainFrame)) return;
    event.preventDefault();
    if (!event.isMainFrame) log.warn("frame.navigation-blocked", { ...hostOnly(url) });
  });
  // FR-047: reloads come only from menu roles, and no build's menu registers a reload accelerator (007
  // research §13). Blocking Cmd/Ctrl+R here would also swallow New reminder (Mod+Shift+R) and any remap.
}
