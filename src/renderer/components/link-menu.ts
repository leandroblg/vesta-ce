/**
 * 016 FR-016, FR-016a, FR-016c (PRD Q234, Q241, Q255; ui.md "Link context menu"): what a right-click on a link offers.
 * A safe link gets Copy, Copy Link and Open Link, a stored file also Show in Finder (File Explorer, Folder); a link
 * whose address is not safe gets no menu.
 */
import { isAssetRef } from "../../domain/markdown/assets";
import { isSafeAddress } from "../../domain/markdown/links";
import { ASSET_PROTOCOL } from "../../domain/markdown/policy";
import type { MessageKey } from "../i18n/t";

export type LinkMenuItem = "copy" | "copyLink" | "open" | "reveal";

/** The address as stored: a stored file shown through `vesta-asset://` is its `assets/…` reference again. */
export function storedHref(href: string): string {
  return href.startsWith(ASSET_PROTOCOL) ? href.slice(ASSET_PROTOCOL.length) : href;
}

export function linkMenuItems(href: string): LinkMenuItem[] | null {
  const stored = storedHref(href);
  if (!isSafeAddress(stored)) return null;
  return isAssetRef(stored) ? ["copy", "copyLink", "open", "reveal"] : ["copy", "copyLink", "open"];
}

export function revealLabel(platform: string): MessageKey {
  return platform === "darwin" ? "ctxRevealMac" : platform === "win32" ? "ctxRevealWin" : "ctxRevealLinux";
}
