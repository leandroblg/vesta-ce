/**
 * The color picker's lists and stored color rules (011 FR-008 to FR-017, data-model "Domain types").
 * Pure TypeScript: no Electron, no DOM.
 */
import { MAX_PINNED_COLORS, MAX_RECENT_COLORS } from "../limits";
import type { Nodes } from "mdast";
import { parseMarkdown, walk } from "./parse";
import { normalizeColor } from "./spans";

/** A stored color: `#rrggbbaa`, lowercase (FR-015). */
export type Hex8 = string;

/** The renderer's view of the lists: hex order only (contracts/ipc.md). */
export interface ColorLists {
  pinned: readonly Hex8[];
  recent: readonly Hex8[];
}

/** A pinned color as stored: its value and the time it was pinned (FR-011, PRD Q145). */
export interface PinnedEntry {
  hex: Hex8;
  at: number;
}

const HEX8 = /^#[0-9a-f]{8}$/;

export function isHex8(value: unknown): value is Hex8 {
  return typeof value === "string" && HEX8.test(value);
}

/** An array of at most `max` distinct stored colors (FR-012, FR-017). */
export function isColorList(value: unknown, max: number): value is Hex8[] {
  if (!Array.isArray(value) || value.length > max) return false;
  if (!value.every(isHex8)) return false;
  return new Set(value).size === value.length;
}

/** The stored pinned list: at most 10 `{ hex, at }` with unique `hex` and a non-negative integer `at` (FR-011). */
export function isPinnedList(value: unknown): value is PinnedEntry[] {
  if (!Array.isArray(value) || value.length > MAX_PINNED_COLORS) return false;
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const keys = Object.keys(entry);
    if (keys.length !== 2 || !Object.hasOwn(entry, "hex") || !Object.hasOwn(entry, "at")) return false;
    const { hex, at } = entry as { hex: unknown; at: unknown };
    if (!isHex8(hex) || typeof at !== "number" || !Number.isInteger(at) || at < 0) return false;
    if (seen.has(hex)) return false;
    seen.add(hex);
  }
  return true;
}

export function sameColor(a: string, b: string): boolean {
  const x = normalizeColor(a);
  return x !== null && x === normalizeColor(b);
}

// ---------------------------------------------------------------------------
// The preset (FR-010): Tailwind CSS v3.4 default palette, MIT License, Copyright (c) Tailwind Labs, Inc.
// Values copied from tailwindcss/src/public/colors.js (v3.4), stored with an opaque alpha.

export type Hue = "red" | "orange" | "amber" | "lime" | "green" | "teal" | "sky" | "blue" | "violet" | "pink";

export interface PresetColor {
  hex: Hex8;
  hue: Hue | "neutral";
  shade: number | "white" | "black";
}

const NEUTRAL_ROW: readonly [string, PresetColor["shade"]][] = [
  ["#ffffff", "white"],
  ["#f3f4f6", 100],
  ["#e5e7eb", 200],
  ["#d1d5db", 300],
  ["#9ca3af", 400],
  ["#6b7280", 500],
  ["#4b5563", 600],
  ["#374151", 700],
  ["#1f2937", 800],
  ["#000000", "black"],
];

const HUE_SHADES: Readonly<Record<Hue, readonly string[]>> = {
  red: ["#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626", "#b91c1c", "#991b1b", "#7f1d1d"],
  orange: ["#ffedd5", "#fed7aa", "#fdba74", "#fb923c", "#f97316", "#ea580c", "#c2410c", "#9a3412", "#7c2d12"],
  amber: ["#fef3c7", "#fde68a", "#fcd34d", "#fbbf24", "#f59e0b", "#d97706", "#b45309", "#92400e", "#78350f"],
  lime: ["#ecfccb", "#d9f99d", "#bef264", "#a3e635", "#84cc16", "#65a30d", "#4d7c0f", "#3f6212", "#365314"],
  green: ["#dcfce7", "#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#166534", "#14532d"],
  teal: ["#ccfbf1", "#99f6e4", "#5eead4", "#2dd4bf", "#14b8a6", "#0d9488", "#0f766e", "#115e59", "#134e4a"],
  sky: ["#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9", "#0284c7", "#0369a1", "#075985", "#0c4a6e"],
  blue: ["#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a"],
  violet: ["#ede9fe", "#ddd6fe", "#c4b5fd", "#a78bfa", "#8b5cf6", "#7c3aed", "#6d28d9", "#5b21b6", "#4c1d95"],
  pink: ["#fce7f3", "#fbcfe8", "#f9a8d4", "#f472b6", "#ec4899", "#db2777", "#be185d", "#9d174d", "#831843"],
};

export const HUES: readonly Hue[] = ["red", "orange", "amber", "lime", "green", "teal", "sky", "blue", "violet", "pink"];

/** The 10 × 10 grid in row-major order: the neutral row, then shades 100 (top) to 900 (bottom) per hue column. */
export const PRESET_COLORS: readonly PresetColor[] = Object.freeze([
  ...NEUTRAL_ROW.map(([hex, shade]): PresetColor => ({ hex: `${hex}ff`, hue: "neutral", shade })),
  ...Array.from({ length: 9 }, (_, row) =>
    HUES.map((hue): PresetColor => ({ hex: `${HUE_SHADES[hue][row] as string}ff`, hue, shade: (row + 1) * 100 })),
  ).flat(),
]);

const PRESET_SET: ReadonlySet<string> = new Set(PRESET_COLORS.map((c) => c.hex));

export function isPreset(color: string): boolean {
  const hex = normalizeColor(color);
  return hex !== null && PRESET_SET.has(hex);
}

// ---------------------------------------------------------------------------
// List rules (FR-011, FR-012). Each returns the same object when nothing changes, so a caller can skip the save
// and the setting's change time stays as it was (FR-016).

export type ColorSource = "preset" | "pinned" | "recent" | "custom";

function withFirst(list: readonly Hex8[], hex: Hex8, max: number): Hex8[] {
  return [hex, ...list.filter((h) => h !== hex)].slice(0, max);
}

export function applied(lists: ColorLists, hex: Hex8, source: ColorSource): ColorLists {
  if (source === "preset" || source === "pinned") return lists;
  if (source === "custom" && (isPreset(hex) || lists.pinned.includes(hex))) return lists;
  if (lists.recent[0] === hex) return lists;
  return { pinned: lists.pinned, recent: withFirst(lists.recent, hex, MAX_RECENT_COLORS) };
}

/** First position, wherever the color came from (Shift+Enter); the 11th drops the last; removed from recent. */
export function pin(lists: ColorLists, hex: Hex8): ColorLists {
  return pinAt(lists, hex, 0);
}

/**
 * 016 FR-028 to FR-030 (PRD Q223): a color dropped on the pinned row lands at `index`, the gap it was dropped in,
 * counted over the row as shown; past the end it is last. A color already pinned moves there. The 11th drops the
 * rightmost; the color leaves the recent list.
 */
export function pinAt(lists: ColorLists, hex: Hex8, index: number): ColorLists {
  const from = lists.pinned.indexOf(hex);
  const rest = lists.pinned.filter((h) => h !== hex);
  // The gap is counted with the color still in the row; once it is taken out, the gaps after it shift by one.
  const at = Math.max(0, Math.min(from >= 0 && from < index ? index - 1 : index, rest.length));
  const pinned = [...rest.slice(0, at), hex, ...rest.slice(at)].slice(0, MAX_PINNED_COLORS);
  const recent = lists.recent.filter((h) => h !== hex);
  const same = pinned.length === lists.pinned.length && pinned.every((h, i) => h === lists.pinned[i]) && recent.length === lists.recent.length;
  return same ? lists : { pinned, recent };
}

/** An unpinned color is not added to the recent list. */
export function unpin(lists: ColorLists, hex: Hex8): ColorLists {
  if (!lists.pinned.includes(hex)) return lists;
  return { pinned: lists.pinned.filter((h) => h !== hex), recent: lists.recent };
}

export function movePinned(lists: ColorLists, from: number, to: number): ColorLists {
  const n = lists.pinned.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return lists;
  const next = [...lists.pinned];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as Hex8);
  return { pinned: next, recent: lists.recent };
}

/** Recent colors never hold a pinned or preset color (FR-012, PRD Q145). */
export function cleanRecent(recent: readonly Hex8[], pinned: readonly Hex8[]): Hex8[] {
  return recent.filter((h) => !pinned.includes(h) && !isPreset(h));
}

/**
 * Main's stamping of pin times (FR-011): a color new to the list, or `pinnedNow` (a pin that moved a color
 * first), gets `now`; every other keeps its time; the order is the renderer's.
 */
export function stampPinned(previous: readonly PinnedEntry[], next: readonly Hex8[], now: number, pinnedNow?: Hex8): PinnedEntry[] {
  const times = new Map(previous.map((e) => [e.hex, e.at]));
  return next.map((hex) => ({ hex, at: hex === pinnedNow ? now : (times.get(hex) ?? now) }));
}

/** Import (FR-017, PRD Q145): union by color, newest time each, newest first (ties keep local order), first 10. */
export function mergePinned(local: readonly PinnedEntry[], imported: readonly PinnedEntry[]): PinnedEntry[] {
  const best = new Map<Hex8, { at: number; order: number }>();
  [...local, ...imported].forEach((e, order) => {
    const seen = best.get(e.hex);
    if (seen === undefined) best.set(e.hex, { at: e.at, order });
    else if (e.at > seen.at) best.set(e.hex, { at: e.at, order: seen.order });
  });
  return [...best.entries()]
    .sort((a, b) => b[1].at - a[1].at || a[1].order - b[1].order)
    .slice(0, MAX_PINNED_COLORS)
    .map(([hex, { at }]) => ({ hex, at }));
}

// ---------------------------------------------------------------------------
// The one-time rewrite of stored colors to 8 digits (FR-015, research §13). Positions come from the shared parser,
// so only a span's own attribute block is touched: code, escaped text and look-alikes stay as written, and nothing
// else is re-serialized.

const COLOR_ATTRIBUTE = /(^|[ \t{])(color|bg)=("([^"\r\n]*)"|([^\s"'=<>`{}]+))/g;

function rewriteBlock(block: string): string {
  const seen = new Set<string>();
  return block.replace(COLOR_ATTRIBUTE, (whole, lead: string, key: string, _v: string, quoted?: string, bare?: string) => {
    if (seen.has(key)) return whole;
    seen.add(key);
    const color = normalizeColor(quoted ?? bare ?? "");
    return color === null ? whole : `${lead}${key}="${color}"`;
  });
}

export function rewriteColors(md: string): string {
  if (!md.includes("{")) return md;
  const blocks: { from: number; to: number }[] = [];
  walk(parseMarkdown(md), (node: Nodes) => {
    if ((node as { type: string }).type !== "vestaSpan") return;
    const end = node.position?.end.offset;
    const start = node.position?.start.offset;
    if (end === undefined || start === undefined) return;
    const children = "children" in node ? node.children : [];
    const lastEnd = children.at(-1)?.position?.end.offset ?? start + 1;
    const open = md.indexOf("{", lastEnd);
    if (open < 0 || open >= end) return;
    blocks.push({ from: open, to: end });
  });
  if (blocks.length === 0) return md;
  let out = md;
  for (const { from, to } of blocks.sort((a, b) => b.from - a.from)) {
    out = out.slice(0, from) + rewriteBlock(out.slice(from, to)) + out.slice(to);
  }
  return out === md ? md : out;
}
