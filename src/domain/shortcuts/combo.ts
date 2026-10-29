/**
 * Key combinations (research §9): the canonical string `Mod+Ctrl+Shift+Alt+<Key>`, built from a key event,
 * and its notation for the eye and for screen readers. `Mod` is Cmd on macOS and Ctrl elsewhere; `Ctrl` is
 * only used on macOS, where it is a separate key.
 */

export type Combo = string;

/** The fields of a KeyboardEvent (or of a key forwarded by main) that a combination is built from. */
export interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Key names from the locale file, so a language can say "Maj" or "Suppr" (FR-033). */
export interface KeyNames {
  cmd: string;
  ctrl: string;
  shift: string;
  alt: string;
  /** The Alt key's name on macOS. */
  option: string;
  enter: string;
  esc: string;
  delete: string;
  backspace: string;
  tab: string;
  space: string;
  home: string;
  end: string;
  pageUp: string;
  pageDown: string;
  insert: string;
  up: string;
  down: string;
  left: string;
  right: string;
}

const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt", "AltGraph", "OS", "CapsLock", "Fn", "Hyper", "Super"]);

const NAMED = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Escape",
  "Tab",
  "Backspace",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  ...Array.from({ length: 12 }, (_, i) => `F${String(i + 1)}`),
]);

const CODE_CHARS: Readonly<Record<string, string>> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

const PARTS = ["Mod", "Ctrl", "Shift", "Alt"] as const;

/** The character a key's code stands for on a US layout, or null. */
function charOfCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1] !== undefined) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit?.[1] !== undefined) return digit[1];
  return CODE_CHARS[code] ?? null;
}

function keyPart(e: KeyLike): string | null {
  if (e.key === " " || e.code === "Space") return "Space";
  if (NAMED.has(e.key)) return e.key;
  // Shift and Alt change the character (Shift+, is "<"; Alt+N is "˜" on macOS): take it from the key's position.
  if (e.shiftKey || e.altKey || e.key === "Dead" || e.key.length !== 1) {
    const fromCode = charOfCode(e.code);
    if (fromCode !== null) return fromCode;
  }
  if (e.key.length === 1) return e.key.toUpperCase();
  return null;
}

/** The combination of a key-down, or null for a press of modifiers only or a key Vesta does not name. */
export function fromKeyEvent(e: KeyLike, isMac: boolean): Combo | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  // The Windows or Super key belongs to the OS.
  if (!isMac && e.metaKey) return null;
  const k = keyPart(e);
  if (k === null) return null;
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push("Mod");
  if (isMac && e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  parts.push(k);
  return parts.join("+");
}

export interface ParsedCombo {
  mod: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/** Splits a combination; null when it is not one `fromKeyEvent` could produce. */
export function parseCombo(combo: Combo): ParsedCombo | null {
  if (combo.length === 0 || combo.length > 40) return null;
  // The key itself may be "+"; split the modifiers off the front.
  const parsed: ParsedCombo = { mod: false, ctrl: false, shift: false, alt: false, key: "" };
  let rest = combo;
  for (const part of PARTS) {
    if (rest.startsWith(`${part}+`) && rest.length > part.length + 1) {
      const flag = part.toLowerCase() as "mod" | "ctrl" | "shift" | "alt";
      parsed[flag] = true;
      rest = rest.slice(part.length + 1);
    }
  }
  if (rest === "Space" || NAMED.has(rest) || (rest.length === 1 && rest === rest.toUpperCase() && rest.trim() !== "")) {
    parsed.key = rest;
    return parsed;
  }
  return null;
}

export function isValidCombo(combo: Combo): boolean {
  return parseCombo(combo) !== null;
}

const ARROWS: Readonly<Record<string, string>> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };

function keyName(key: string, names: KeyNames, arrowsAsSymbols: boolean): string {
  if (arrowsAsSymbols && ARROWS[key] !== undefined) return ARROWS[key];
  switch (key) {
    case "ArrowUp":
      return names.up;
    case "ArrowDown":
      return names.down;
    case "ArrowLeft":
      return names.left;
    case "ArrowRight":
      return names.right;
    case "Enter":
      return names.enter;
    case "Escape":
      return names.esc;
    case "Delete":
      return names.delete;
    case "Backspace":
      return names.backspace;
    case "Tab":
      return names.tab;
    case "Space":
      return names.space;
    case "Home":
      return names.home;
    case "End":
      return names.end;
    case "PageUp":
      return names.pageUp;
    case "PageDown":
      return names.pageDown;
    case "Insert":
      return names.insert;
    default:
      return key;
  }
}

/** "⌘⇧N" on macOS, "Ctrl+Shift+N" elsewhere (FR-033). */
export function label(combo: Combo, isMac: boolean, names: KeyNames): string {
  const p = parseCombo(combo);
  if (p === null) return combo;
  // 011 FR-031: Return is ↩ among the macOS symbols (⌘↩), like ⌘ and ⇧.
  const k = isMac && p.key === "Enter" ? "↩" : keyName(p.key, names, true);
  if (isMac) {
    return `${p.ctrl ? "⌃" : ""}${p.alt ? "⌥" : ""}${p.shift ? "⇧" : ""}${p.mod ? "⌘" : ""}${k}`;
  }
  const parts: string[] = [];
  if (p.mod) parts.push(names.ctrl);
  if (p.shift) parts.push(names.shift);
  if (p.alt) parts.push(names.alt);
  parts.push(k);
  return parts.join("+");
}

/** The combination in words, for `aria-label` (CHK028): "Command Shift N". */
export function spoken(combo: Combo, isMac: boolean, names: KeyNames): string {
  const p = parseCombo(combo);
  if (p === null) return combo;
  const parts: string[] = [];
  if (p.mod) parts.push(isMac ? names.cmd : names.ctrl);
  if (p.ctrl) parts.push(names.ctrl);
  if (p.shift) parts.push(names.shift);
  if (p.alt) parts.push(isMac ? names.option : names.alt);
  parts.push(keyName(p.key, names, false));
  return parts.join(" ");
}
