/**
 * Icons (HIG identity review, §3 and §8): standard symbols drawn on a 24-unit grid at the weight of
 * the system text, outline by default; the hearth mark is the only custom glyph. All decorative: the control
 * carries the accessible name.
 */
import type { SVGProps } from "react";

const common = { "aria-hidden": true, focusable: false } as const;

/** An outline glyph: 1.8 stroke, round caps and joins, no fill. */
function Glyph({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...common} {...rest}>
      {children}
    </svg>
  );
}

/** The flame on its hearth line inside the ring of the round temple; the flame takes the current color. */
const HEARTH_RING = "M6.46 19.09A9 9 0 1 1 17.54 19.09M5 21.5h14";
const HEARTH_FLAME =
  "M12 6.2c.7 2.2 3.1 3.6 3.1 6.5A3.1 3.1 0 0 1 12 15.8a3.1 3.1 0 0 1-3.1-3.1c0-1.4.7-2.3 1.4-3 .1 1 .6 1.6 1.3 1.9-.4-1.8.1-3.8.4-5.4z";

/** The hearth mark: monochrome by default; `flame` colors the flame alone (the window identity uses the gold). */
export const Hearth = ({ flame, className }: { flame?: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} {...common}>
    <path d={HEARTH_RING} />
    <path fill={flame ?? "currentColor"} stroke="none" d={HEARTH_FLAME} />
  </svg>
);

/**
 * The app icon (identity §4), default appearance: travertine ground, bronze hearth ring, gold-to-ember flame.
 * Shown in About; the Dock and Finder get the same layers from build/icon (feature 013 packaging).
 */
export const AppIcon = ({ size = 96 }: { size?: number }) => (
  <svg viewBox="0 0 128 128" width={size} height={size} className="app-icon" {...common}>
    <defs>
      <linearGradient id="vesta-ic-bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#F7F2E9" />
        <stop offset="1" stopColor="#E4D9C6" />
      </linearGradient>
      <linearGradient id="vesta-ic-fl" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#F2B64C" />
        <stop offset="0.55" stopColor="#E08A2C" />
        <stop offset="1" stopColor="#B9411C" />
      </linearGradient>
    </defs>
    <rect x="4" y="4" width="120" height="120" rx="27" fill="url(#vesta-ic-bg)" />
    <g transform="translate(16 14) scale(4)" fill="none" stroke="#8A6A3A" strokeWidth="2.2" strokeLinecap="round">
      <path d="M6.46 19.09A9 9 0 1 1 17.54 19.09" />
      <path d="M5 21.5h14" stroke="#6E5430" />
      <path fill="url(#vesta-ic-fl)" stroke="none" d={HEARTH_FLAME} />
    </g>
  </svg>
);

export const Caret = () => (
  <Glyph className="caret" strokeWidth="2.2">
    <path d="m6 9 6 6 6-6" />
  </Glyph>
);
/** 015: marks a context-menu item that opens a row (Postpone For). */
export const SubMark = () => (
  <Glyph className="sub-mark" strokeWidth="2.2">
    <path d="m9 6 6 6-6 6" />
  </Glyph>
);
export const Edit = () => (
  <Glyph>
    <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
  </Glyph>
);
export const Dots = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...common}>
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);
export const Grip = () => (
  <svg viewBox="0 0 12 16" fill="currentColor" {...common}>
    <circle cx="3" cy="3" r="1.5" />
    <circle cx="9" cy="3" r="1.5" />
    <circle cx="3" cy="8" r="1.5" />
    <circle cx="9" cy="8" r="1.5" />
    <circle cx="3" cy="13" r="1.5" />
    <circle cx="9" cy="13" r="1.5" />
  </svg>
);
export const Plus = () => (
  <Glyph strokeWidth="2.2">
    <path d="M12 5v14M5 12h14" />
  </Glyph>
);
export const Close = () => (
  <Glyph strokeWidth="2">
    <path d="M6 6l12 12M18 6 6 18" />
  </Glyph>
);
export const Back = () => (
  <Glyph strokeWidth="2.2">
    <path d="m15 6-6 6 6 6" />
  </Glyph>
);
export const Sub = () => (
  <Glyph>
    <path d="M5 4v9a3 3 0 0 0 3 3h11M15 12l4 4-4 4" />
  </Glyph>
);
/** Details: info.circle (identity §8). */
export const Panel = () => (
  <Glyph>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5" />
    <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
  </Glyph>
);
export const Restore = () => (
  <Glyph>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
  </Glyph>
);
export const Search = () => (
  <Glyph>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4-4" />
  </Glyph>
);
/** Search options: line.3.horizontal.decrease. */
export const Filter = () => (
  <Glyph>
    <path d="M4 7h16M7 12h10M10 17h4" />
  </Glyph>
);
export const ArchiveIcon = () => (
  <Glyph>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v10h14V9M10 13h4" />
  </Glyph>
);
export const TrashIcon = () => (
  <Glyph>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </Glyph>
);
export const Cog = () => (
  <Glyph>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Glyph>
);
export const Clock = () => (
  <Glyph strokeWidth="2">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v4.5l3 2" />
  </Glyph>
);
export const Resched = () => (
  <Glyph>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
    <path d="M12 8v4l3 2" />
  </Glyph>
);
export const Bell = () => (
  <Glyph>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />
  </Glyph>
);
export const Alert = () => (
  <Glyph strokeWidth="2">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v5M12 17h.01" />
  </Glyph>
);
export const Check = () => (
  <Glyph strokeWidth="2.2">
    <path d="m5 12 5 5 9-10" />
  </Glyph>
);
/** Settings panes: slider.horizontal.3, keyboard, externaldrive, arrow.down.circle. */
export const Sliders = () => (
  <Glyph>
    <path d="M4 7h8M16 7h4M4 12h2M10 12h10M4 17h10M18 17h2" />
    <circle cx="14" cy="7" r="2" />
    <circle cx="8" cy="12" r="2" />
    <circle cx="16" cy="17" r="2" />
  </Glyph>
);
export const Keyboard = () => (
  <Glyph>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
  </Glyph>
);
export const Drive = () => (
  <Glyph>
    <rect x="3" y="8" width="18" height="8" rx="2" />
    <circle cx="7" cy="12" r="0.9" fill="currentColor" stroke="none" />
  </Glyph>
);
export const Download = () => (
  <Glyph>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v8M8.5 12.5l3.5 3.5 3.5-3.5" />
  </Glyph>
);
