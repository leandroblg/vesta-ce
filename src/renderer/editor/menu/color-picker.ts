// The color picker shared by text color and highlight color (011 US2, FR-008 to FR-014, research §9,
// contracts/ui.md). Vanilla DOM like the menu; appended to document.body so a row's overflow never clips it;
// role="dialog" keeps the details panel open (useClickRules).
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  PRESET_COLORS,
  applied,
  movePinned,
  pinAt,
  unpin,
  type ColorLists,
  type ColorSource,
  type Hex8,
  type PresetColor,
} from "../../../domain/markdown/colors";
import { adaptFill, adaptForContrast } from "../../../domain/markdown/contrast";
import { normalizeColor, type SpanAttributes } from "../../../domain/markdown/spans";
import { surfacesOf } from "../../../domain/theme-surfaces";
import { currentPalette } from "../../theme";
import { DEFAULT_TEXT_COLOR } from "../../../domain/settings";
import { shiftEnterKey, t, type MessageKey } from "../../i18n/t";
import { currentTheme } from "../../markdown/paint";
import { menuRange, setSpanIn, setStoredSpan, type RangeScope } from "./block-toggles";

export type ColorKey = "color" | "bg";

/** The editor's way to the store's lists (011 FR-016); without one, the lists live in memory. */
export interface ColorListsPort {
  get(): ColorLists;
  set(next: { pinned?: string[]; recent?: string[]; pinnedNow?: string }): void;
  /** 016 FR-019, FR-022: the last text color picked, which the Text color button applies; the ember when absent. */
  lastTextColor?(): Hex8;
  setLastTextColor?(hex: Hex8): void;
}

export function memoryPort(initial: ColorLists = { pinned: [], recent: [] }): ColorListsPort {
  let lists = initial;
  let lastText: Hex8 = DEFAULT_TEXT_COLOR;
  return {
    lastTextColor: () => lastText,
    setLastTextColor: (hex) => {
      lastText = hex;
    },
    get: () => lists,
    set: (next) => {
      lists = { pinned: next.pinned ?? lists.pinned, recent: (next.recent ?? lists.recent).filter((h) => !(next.pinned ?? lists.pinned).includes(h)) };
    },
  };
}

export interface ColorPicker {
  readonly element: HTMLElement;
  open(key: ColorKey, anchor: HTMLElement, focus: boolean): void;
  close(focusAnchor: boolean): void;
  isOpen(): boolean;
  /** True while a row is rebuilt: focus briefly leaves a removed swatch, which is not the edit ending. */
  rerendering(): boolean;
  relabel(): void;
  destroy(): void;
}

/**
 * 016 FR-028 (PRD Q223): the gap a drop at `x` lands in, over the pinned swatches' boxes in row order: before each
 * swatch whose middle is right of `x`; on padding or a gap that is the nearest gap; past the end or on an empty row,
 * the end.
 */
export function dropIndex(x: number, boxes: readonly { left: number; width: number }[]): number {
  const before = boxes.findIndex((b) => x < b.left + b.width / 2);
  return before < 0 ? boxes.length : before;
}

/** 016 FR-019: the color a click on the Text color button applies. */
export function textSwatch(port: ColorListsPort): Hex8 {
  return port.lastTextColor?.() ?? DEFAULT_TEXT_COLOR;
}

const DEFAULTS: Record<ColorKey, Hex8> = { color: "#c3321eff", bg: "#ffe066ff" };
const DRAG_TYPE = "application/x-vesta-color";
const HUE_KEY: Record<string, MessageKey> = {
  red: "hueRed",
  orange: "hueOrange",
  amber: "hueAmber",
  lime: "hueLime",
  green: "hueGreen",
  teal: "hueTeal",
  sky: "hueSky",
  blue: "hueBlue",
  violet: "hueViolet",
  pink: "huePink",
};
/** The last color applied from the picker in this session (FR-013 fallback). */
const lastApplied: Partial<Record<ColorKey, Hex8>> = {};

function presetName(c: PresetColor): string {
  if (c.shade === "white") return t("hueWhite");
  if (c.shade === "black") return t("hueBlack");
  return t("cpSwatch", { hue: c.hue === "neutral" ? t("hueGray") : t(HUE_KEY[c.hue] as MessageKey), shade: c.shade });
}

/** The color every text node of the range shares, or null (FR-013, US2-12). */
export function currentColor(view: EditorView, key: ColorKey, scope: RangeScope = "details"): Hex8 | null {
  const span = view.state.schema.marks["vestaSpan"];
  const { from, to } = menuRange(view.state, scope);
  const seen = new Set<string | null>();
  view.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true;
    const attrs = span?.isInSet(node.marks)?.attrs as SpanAttributes | undefined;
    seen.add(attrs?.[key] ?? null);
    return false;
  });
  const [only] = [...seen];
  return seen.size === 1 && typeof only === "string" ? only : null;
}

function isAdjusted(hex: Hex8, key: ColorKey): boolean {
  const surfaces = surfacesOf(currentTheme(), currentPalette()).surfaces;
  return key === "color" ? adaptForContrast(hex, surfaces, 4.5) !== hex : adaptFill(hex, surfaces) !== hex;
}

export function createColorPicker(
  view: EditorView,
  port: ColorListsPort,
  onApplied: () => void,
  scope: RangeScope = "details",
): ColorPicker {
  const el = document.createElement("div");
  el.className = "cpick";
  el.setAttribute("role", "dialog");
  el.hidden = true;
  let key: ColorKey = "color";
  let anchor: HTMLElement | null = null;

  const auto = document.createElement("button");
  auto.type = "button";
  auto.className = "cp-auto";
  auto.dataset.section = "auto";
  auto.dataset.color = "auto";

  const grid = document.createElement("div");
  grid.className = "cp-grid";
  grid.dataset.section = "preset";
  grid.setAttribute("role", "grid");

  const pinnedHead = document.createElement("div");
  pinnedHead.className = "cp-head";
  const pinned = document.createElement("div");
  pinned.className = "cp-row cp-pinned";
  pinned.dataset.section = "pinned";
  pinned.setAttribute("role", "listbox");
  pinned.setAttribute("aria-orientation", "horizontal");

  const recentHead = document.createElement("div");
  recentHead.className = "cp-head";
  const recent = document.createElement("div");
  recent.className = "cp-row cp-recent";
  recent.dataset.section = "recent";
  recent.setAttribute("role", "listbox");
  const recentEmpty = document.createElement("p");
  recentEmpty.className = "cp-empty";

  const custom = document.createElement("button");
  custom.type = "button";
  custom.className = "cp-custom";
  custom.dataset.section = "custom";
  const native = document.createElement("input");
  native.type = "color";
  native.className = "cp-native";
  native.tabIndex = -1;
  native.setAttribute("aria-hidden", "true");

  el.append(auto, grid, pinnedHead, pinned, recentHead, recent, recentEmpty, custom, native);

  // The preset grid, built once: 10 rows of 10 (FR-010).
  for (let row = 0; row < 10; row++) {
    const r = document.createElement("div");
    r.setAttribute("role", "row");
    r.className = "cp-gridrow";
    for (let col = 0; col < 10; col++) {
      const c = PRESET_COLORS[row * 10 + col] as PresetColor;
      r.append(swatch(c.hex, "gridcell", "preset"));
    }
    grid.append(r);
  }

  function swatch(hex: Hex8, role: string, section: string): HTMLElement {
    const s = document.createElement(role === "option" ? "div" : "button");
    if (s instanceof HTMLButtonElement) s.type = "button";
    s.className = "cp-sw";
    s.setAttribute("role", role);
    s.dataset.hex = hex;
    s.dataset.section = section;
    s.tabIndex = -1;
    s.draggable = true;
    const chip = document.createElement("span");
    chip.className = "cp-chip";
    chip.setAttribute("aria-hidden", "true");
    // The CSP forbids style attributes; the CSSOM is allowed.
    chip.style.backgroundColor = hex;
    s.append(chip);
    return s;
  }

  function labels(): void {
    el.setAttribute("aria-label", t(key === "color" ? "fmColor" : "fmHighlightColor"));
    // 012 FR-020, FR-021 (PRD Q154): the first choice says what it removes.
    auto.textContent = t(key === "color" ? "cpRemoveColor" : "cpRemoveHighlight");
    grid.setAttribute("aria-label", t("cpPreset"));
    pinnedHead.textContent = t("cpPinned");
    pinned.setAttribute("aria-label", t("cpPinned"));
    recentHead.textContent = t("cpRecent");
    recent.setAttribute("aria-label", t("cpRecent"));
    recentEmpty.textContent = t("cpRecentEmpty");
    custom.textContent = t("cpCustom");
    const shiftEnter = shiftEnterKey();
    for (const s of Array.from(grid.querySelectorAll<HTMLElement>(".cp-sw"))) {
      const c = PRESET_COLORS.find((p) => p.hex === s.dataset.hex) as PresetColor;
      s.setAttribute("aria-label", presetName(c));
      s.title = `${presetName(c)} · ${t("cpPinHint", { shiftEnter })}`;
    }
  }

  let rebuilding = false;

  /** Current color, adjusted marks and the two lists; the focused color keeps the focus. */
  function render(): void {
    const focused = document.activeElement instanceof HTMLElement && el.contains(document.activeElement) ? document.activeElement : null;
    const keep = focused?.dataset.hex === undefined ? null : { hex: focused.dataset.hex, section: focused.dataset.section };
    rebuilding = true;
    try {
      draw();
    } finally {
      rebuilding = false;
    }
    if (keep !== null && !el.contains(document.activeElement)) {
      const again = el.querySelector<HTMLElement>(`.cp-sw[data-section="${keep.section ?? ""}"][data-hex="${keep.hex}"]`);
      (again ?? auto).focus();
    }
  }

  function draw(): void {
    const lists = port.get();
    const current = currentColor(view, key, scope);
    const fill = (row: HTMLElement, hexes: readonly Hex8[], slots: number, section: string) => {
      row.replaceChildren();
      hexes.forEach((hex) => {
        const s = swatch(hex, "option", section);
        s.setAttribute("aria-label", hex);
        s.setAttribute("aria-selected", "false");
        if (section === "pinned") {
          const x = document.createElement("button");
          x.type = "button";
          x.className = "cp-unpin";
          x.tabIndex = -1;
          x.textContent = "×";
          x.setAttribute("aria-label", t("cpUnpin"));
          x.title = t("cpUnpin");
          s.append(x);
        }
        row.append(s);
      });
      for (let i = hexes.length; i < slots; i++) {
        const empty = document.createElement("span");
        empty.className = "cp-slot";
        empty.setAttribute("aria-hidden", "true");
        row.append(empty);
      }
    };
    fill(pinned, lists.pinned, 10, "pinned");
    fill(recent, lists.recent, 20, "recent");
    recentEmpty.hidden = lists.recent.length > 0;
    for (const s of sections().flatMap((sec) => items(sec))) {
      const hex = s.dataset.hex;
      const isCurrent = hex === undefined ? current === null && !(key === "bg" && defaultHighlightIn()) : hex === current;
      if (isCurrent) s.setAttribute("aria-current", "true");
      else s.removeAttribute("aria-current");
      s.classList.toggle("cp-current", isCurrent);
      s.querySelector(".cp-adjusted")?.remove();
      if (hex !== undefined && isAdjusted(hex, key)) {
        const dot = document.createElement("span");
        dot.className = "cp-adjusted";
        dot.setAttribute("aria-hidden", "true");
        s.append(dot);
        s.setAttribute("aria-description", t("cpAdjusted"));
      } else s.removeAttribute("aria-description");
    }
    rove();
  }

  // ---- Keyboard: one Tab stop per section, arrows inside (US2-12).
  const sections = (): HTMLElement[] => [auto, grid, pinned, recent, custom].filter((s) => s === auto || s === custom || items(s).length > 0);
  const items = (section: HTMLElement): HTMLElement[] =>
    section === auto || section === custom ? [section] : Array.from(section.querySelectorAll<HTMLElement>(".cp-sw"));
  const active = new Map<HTMLElement, number>();

  function rove(): void {
    for (const sec of [auto, grid, pinned, recent, custom]) {
      const list = items(sec);
      const at = Math.min(active.get(sec) ?? 0, Math.max(0, list.length - 1));
      list.forEach((item, i) => (item.tabIndex = i === at ? 0 : -1));
    }
  }

  function sectionOf(node: HTMLElement): HTMLElement | null {
    return [auto, grid, pinned, recent, custom].find((s) => s === node || s.contains(node)) ?? null;
  }

  function focusItem(section: HTMLElement, index: number): void {
    const list = items(section);
    if (list.length === 0) return;
    const at = Math.max(0, Math.min(list.length - 1, index));
    active.set(section, at);
    rove();
    list[at]?.focus();
  }

  // ---- Actions
  /** 012 FR-021: the range holds a default (==text==) highlight. */
  function defaultHighlightIn(): boolean {
    const mark = view.state.schema.marks["mark"];
    const { from, to } = menuRange(view.state, scope);
    return mark !== undefined && view.state.doc.rangeHasMark(from, to, mark);
  }

  function apply(hex: Hex8 | null, source: ColorSource | null): void {
    const { from, to } = menuRange(view.state, scope);
    const tr = view.state.tr;
    // An empty paragraph: the color goes to the next typed text (Edge Cases).
    if (from === to) setStoredSpan(tr, view.state, key, hex);
    else setSpanIn(tr, from, to, key, hex);
    // 012 FR-021: Remove highlight removes the default highlight too.
    const mark = view.state.schema.marks["mark"];
    if (hex === null && key === "bg" && mark) {
      if (from === to) tr.removeStoredMark(mark);
      else tr.removeMark(from, to, mark);
    }
    // FR-022: a choice that changes nothing records no Undo step (stored marks only touch the next typing).
    if (tr.docChanged || tr.storedMarksSet) view.dispatch(tr);
    // 016 FR-021: a text color picked here becomes the Text color button's swatch; Remove color and Highlight do not.
    if (hex !== null && key === "color") port.setLastTextColor?.(hex);
    if (hex !== null && source !== null) {
      lastApplied[key] = hex;
      const before = port.get();
      const next = applied(before, hex, source);
      if (next !== before) port.set({ recent: [...next.recent] });
    }
    close(false);
    view.focus();
    onApplied();
  }

  /** Shift+Enter pins first (`index` 0); a drop pins where it lands (016 FR-028, FR-029). */
  function pinColor(hex: Hex8, index = 0): void {
    const before = port.get();
    const next = pinAt(before, hex, index);
    if (next === before) return;
    port.set({ pinned: [...next.pinned], recent: [...next.recent], pinnedNow: hex });
    render();
  }

  function unpinColor(hex: Hex8): void {
    const before = port.get();
    const next = unpin(before, hex);
    if (next === before) return;
    port.set({ pinned: [...next.pinned] });
    render();
    focusItem(items(pinned).length > 0 ? pinned : auto, active.get(pinned) ?? 0);
  }

  function move(from: number, to: number): void {
    const before = port.get();
    const next = movePinned(before, from, to);
    if (next === before) return;
    port.set({ pinned: [...next.pinned] });
    render();
    focusItem(pinned, to);
  }

  function choose(item: HTMLElement): void {
    if (item === auto) apply(null, null);
    else if (item === custom) openCustom();
    else if (item.dataset.hex !== undefined) {
      const source = item.dataset.section === "pinned" ? "pinned" : item.dataset.section === "recent" ? "recent" : "preset";
      apply(item.dataset.hex, source);
    }
  }

  function openCustom(): void {
    const start = currentColor(view, key, scope) ?? lastApplied[key] ?? DEFAULTS[key];
    native.value = start.slice(0, 7);
    try {
      native.showPicker();
    } catch {
      native.click();
    }
  }
  // A confirmed system selector applies; a cancelled one fires nothing and the picker stays open (US2-4).
  native.addEventListener("change", () => {
    const hex = normalizeColor(native.value);
    if (hex !== null) apply(hex, "custom");
  });

  el.addEventListener("mousedown", (e) => {
    // Clicks keep the editor's selection, as the menu's do.
    if (e.target instanceof Element && e.target.closest("button, .cp-sw")) e.preventDefault();
  });
  el.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const x = target?.closest<HTMLElement>(".cp-unpin");
    if (x) {
      const hex = x.closest<HTMLElement>(".cp-sw")?.dataset.hex;
      if (hex !== undefined) unpinColor(hex);
      return;
    }
    const item = target?.closest<HTMLElement>(".cp-sw, .cp-auto, .cp-custom");
    if (item) choose(item);
  });
  el.addEventListener("contextmenu", (e) => {
    const item = e.target instanceof Element ? e.target.closest<HTMLElement>(".cp-pinned .cp-sw") : null;
    if (!item) return;
    e.preventDefault();
    // The pinned swatch's context menu offers Unpin, through its own button (US2-9).
    item.querySelector<HTMLElement>(".cp-unpin")?.focus();
  });
  el.addEventListener("keydown", (e) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target === null) return;
    // Keys the picker handles never reach the app's shortcuts (Shift+Enter, Delete, Alt+arrows mean other things there).
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "Escape") {
      handled();
      close(true);
      return;
    }
    if (target.classList.contains("cp-unpin")) {
      if (e.key === "Enter" || e.key === " ") {
        handled();
        const hex = target.closest<HTMLElement>(".cp-sw")?.dataset.hex;
        if (hex !== undefined) unpinColor(hex);
      }
      return;
    }
    const section = sectionOf(target);
    if (section === null) return;
    const list = items(section);
    const at = list.indexOf(target);
    const hex = target.dataset.hex;
    if (e.key === "Enter" && e.shiftKey) {
      handled();
      if (hex !== undefined) pinColor(hex);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      handled();
      choose(target);
      return;
    }
    if (section === pinned && hex !== undefined && (e.key === "Delete" || e.key === "Backspace")) {
      handled();
      unpinColor(hex);
      return;
    }
    if (section === pinned && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      handled();
      move(at, at + (e.key === "ArrowLeft" ? -1 : 1));
      return;
    }
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -10, ArrowDown: 10 };
    const d = step[e.key];
    if (d === undefined || at < 0 || section === auto || section === custom) return;
    if (section === pinned && Math.abs(d) === 10) return;
    handled();
    focusItem(section, at + d);
  });

  // ---- Drag and drop (US2-6, US2-8)
  el.addEventListener("dragstart", (e) => {
    const item = e.target instanceof Element ? e.target.closest<HTMLElement>(".cp-sw") : null;
    if (!item || e.dataTransfer === null || item.dataset.hex === undefined) return;
    const list = items(sectionOf(item) ?? grid);
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ hex: item.dataset.hex, section: item.dataset.section, index: list.indexOf(item) }));
    e.dataTransfer.effectAllowed = "move";
  });
  pinned.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes(DRAG_TYPE) === true) e.preventDefault();
  });
  pinned.addEventListener("drop", (e) => {
    const raw = e.dataTransfer?.getData(DRAG_TYPE);
    if (raw === undefined || raw === "") return;
    e.preventDefault();
    const data = JSON.parse(raw) as { hex: string; section: string; index: number };
    if (data.section !== "pinned") {
      // 016 FR-028 (PRD Q223): where the pointer is over the pinned swatches.
      pinColor(data.hex, dropIndex(e.clientX, items(pinned).map((sw) => sw.getBoundingClientRect())));
      return;
    }
    const over = e.target instanceof Element ? e.target.closest<HTMLElement>(".cp-sw") : null;
    const to = over === null ? items(pinned).length - 1 : items(pinned).indexOf(over);
    move(data.index, to);
  });

  // ---- Placement next to its button, fully visible (FR-008, Edge Cases)
  function place(): void {
    if (anchor === null || el.hidden) return;
    const a = anchor.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const gap = 6;
    let top = a.bottom + gap;
    if (top + box.height > window.innerHeight - gap) top = Math.max(gap, a.top - gap - box.height);
    const left = Math.max(gap, Math.min(window.innerWidth - box.width - gap, a.left));
    el.style.top = `${String(Math.round(top))}px`;
    el.style.left = `${String(Math.round(left))}px`;
  }

  function close(focusAnchor: boolean): void {
    if (el.hidden) return;
    el.hidden = true;
    anchor?.setAttribute("aria-expanded", "false");
    if (focusAnchor) anchor?.focus();
  }

  document.body.append(el);
  const onScroll = () => {
    place();
  };
  window.addEventListener("resize", onScroll);
  window.addEventListener("scroll", onScroll, true);

  return {
    element: el,
    open(k, a, focus) {
      key = k;
      anchor?.setAttribute("aria-expanded", "false");
      anchor = a;
      a.setAttribute("aria-expanded", "true");
      labels();
      el.hidden = false;
      render();
      place();
      if (focus) {
        const current = items(grid).findIndex((s) => s.dataset.hex === currentColor(view, key, scope));
        if (current >= 0) focusItem(grid, current);
        else focusItem(auto, 0);
      }
    },
    close,
    isOpen: () => !el.hidden,
    rerendering: () => rebuilding,
    relabel() {
      labels();
      if (!el.hidden) render();
    },
    destroy() {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
      el.remove();
    },
  };
}
