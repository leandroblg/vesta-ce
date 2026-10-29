/**
 * The surfaces text is drawn on in each palette and theme, and the theme's text color (011 FR-009, research §10;
 * HIG identity: one set per palette). A copy of src/renderer/styles/tokens.css (`--surface`, `--bg`,
 * `--surface-2`, `--stale-soft`, `--accent-soft`, `--fg`, 013's `--accent`, `--accent-fg`, and 014's `--muted`, `--stale`,
 * `--stale-blink`, `--fg-3`, `--stale-fg` of every `palette:… mode:…` block);
 * tests/unit/domain/theme-surfaces.test.ts fails when the two drift. Stored form: `#rrggbbaa`.
 */
import type { Hex8 } from "./markdown/colors";
import { DEFAULT_PALETTE, type PaletteSetting } from "./settings";

export type Theme = "light" | "dark";

export interface SurfaceSet {
  surfaces: readonly Hex8[];
  fg: Hex8;
  /** 013 FR-034 (research §11): the selected card's fill (`--accent`) and the text drawn on it (`--accent-fg`). */
  accent: { fill: Hex8; fg: Hex8 };
  /** 014 FR-006a to FR-006d (research §3): the card icons' colors (`--muted`, `--stale`), the blink's bright phase
   *  (`--stale-blink`) and the old drag handle's `--fg-3` (translucent), measured against every card background. */
  icons: { muted: Hex8; stale: Hex8; staleBlink: Hex8; fg3: Hex8 };
  /** 014 FR-006e: the age's text (`--stale-fg`), measured on the blink's bright phase. */
  text: { staleFg: Hex8 };
}

export const SURFACES: Readonly<Record<PaletteSetting, Readonly<Record<Theme, SurfaceSet>>>> = {
  hearth: {
    light: { surfaces: ["#fbfaf7ff", "#f3efe7ff", "#e9e4daff", "#f4e8e1ff", "#e3e7eaff"], fg: "#1e1a16ff", accent: { fill: "#2f5f8eff", fg: "#ffffffff" }, icons: { muted: "#6b6259ff", stale: "#b9411cff", staleBlink: "#e9c4b4ff", fg3: "#1e1a1652" }, text: { staleFg: "#7a2a10ff" } },
    dark: { surfaces: ["#242120ff", "#1a1816ff", "#302c28ff", "#432e28ff", "#373c43ff"], fg: "#ede7deff", accent: { fill: "#8db7e2ff", fg: "#0c1722ff" }, icons: { muted: "#a69d92ff", stale: "#ff7b57ff", staleBlink: "#6a3f33ff", fg3: "#ede7de52" }, text: { staleFg: "#ffb4a0ff" } },
  },
  system: {
    light: { surfaces: ["#ffffffff", "#f1f1f1ff", "#e8e8e8ff", "#ffebeaff", "#dbecffff"], fg: "#1d1d1fff", accent: { fill: "#0b6ad6ff", fg: "#ffffffff" }, icons: { muted: "#636366ff", stale: "#d70015ff", staleBlink: "#ffc9c5ff", fg3: "#00000047" }, text: { staleFg: "#93000aff" } },
    dark: { surfaces: ["#1e1e20ff", "#2a2a2cff", "#38383aff", "#341c1cff", "#193451ff"], fg: "#e5e5eaff", accent: { fill: "#0a84ffff", fg: "#061a2eff" }, icons: { muted: "#a1a1a6ff", stale: "#ff453aff", staleBlink: "#562a28ff", fg3: "#ffffff47" }, text: { staleFg: "#ffb3adff" } },
  },
  ubuntu: {
    light: { surfaces: ["#ffffffff", "#f6f5f4ff", "#e9e6e3ff", "#f3e8eeff", "#fdebe4ff"], fg: "#2c2c2cff", accent: { fill: "#c7431aff", fg: "#ffffffff" }, icons: { muted: "#666360ff", stale: "#772953ff", staleBlink: "#e2c3d4ff", fg3: "#2c2c2c4d" }, text: { staleFg: "#5e2750ff" } },
    dark: { surfaces: ["#2e2e2eff", "#242424ff", "#3b3b3bff", "#3e2a36ff", "#44322bff"], fg: "#f2f2f2ff", accent: { fill: "#f08d5fff", fg: "#2a1208ff" }, icons: { muted: "#b4b1aeff", stale: "#d98bb7ff", staleBlink: "#5a3a4dff", fg3: "#f2f2f24d" }, text: { staleFg: "#f0c4ddff" } },
  },
  minimal: {
    light: { surfaces: ["#ffffffff", "#ffffffff", "#f2f2f2ff", "#fbedebff", "#edededff"], fg: "#111111ff", accent: { fill: "#111111ff", fg: "#ffffffff" }, icons: { muted: "#666666ff", stale: "#b3261eff", staleBlink: "#f3cfcbff", fg3: "#0000004d" }, text: { staleFg: "#8c1d17ff" } },
    dark: { surfaces: ["#181818ff", "#121212ff", "#262626ff", "#3a1f1cff", "#2c2c2cff"], fg: "#edededff", accent: { fill: "#edededff", fg: "#121212ff" }, icons: { muted: "#a0a0a0ff", stale: "#ff8a80ff", staleBlink: "#5c2f2aff", fg3: "#ffffff4d" }, text: { staleFg: "#ffb4abff" } },
  },
};

export function surfacesOf(theme: Theme, palette: PaletteSetting = DEFAULT_PALETTE): SurfaceSet {
  return SURFACES[palette][theme];
}
