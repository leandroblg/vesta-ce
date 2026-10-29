/**
 * 016 FR-015a, FR-016b, FR-016c (PRD Q245, Q255; research §8): the one rule for which addresses Vesta links, opens or
 * copies. A web or mail address, or a file Vesta stores, is safe; a typed local path or `file:` link is copied after
 * the confirmation of A5; anything else is refused.
 */
import { isAssetRef } from "./assets";

export type AddressKind = "web" | "mail" | "asset" | "path" | "refused";

const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

export function classifyAddress(raw: string): AddressKind {
  const value = raw.trim();
  if (value === "") return "refused";
  if (isAssetRef(value)) return "asset";
  if (/^file:/i.test(value) || ABSOLUTE_PATH.test(value)) return "path";
  if (/^mailto:\S+$/i.test(value)) return "mail";
  // A host must follow the slashes: "http:///path" is refused, though the URL parser would supply one.
  if (/^https?:\/\/[^/\s?#]/i.test(value)) {
    try {
      return new URL(value).hostname === "" ? "refused" : "web";
    } catch {
      return "refused";
    }
  }
  return "refused";
}

/**
 * A stored link with this address may be opened or copied (FR-016, FR-016c): a web or mail address or a stored file.
 * A raw path or `file:` link left in old text is not: typed paths become stored files when they are applied.
 */
export function isSafeAddress(raw: string): boolean {
  const kind = classifyAddress(raw);
  return kind === "web" || kind === "mail" || kind === "asset";
}
