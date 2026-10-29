/**
 * 017 FR-011 (research §3): an Icon Composer bundle (`Vesta.icon`: icon.json and Assets/) built from the layers in
 * build/icon/, so macOS draws the Default, Dark, Clear and Tinted appearances (app icon notes). The ground is the
 * icon's fill; the hearth ring and the flame are layers, with Dark variants in icon-dark.svg's colors.
 */

/** Light color → Dark color, as icon-dark.svg draws them. */
export const DARK_COLORS: Readonly<Record<string, string>> = {
  "#8A6A3A": "#C89A52",
  "#6E5430": "#A47D3F",
  "#F2B64C": "#FFD27A",
  "#E08A2C": "#F0A14A",
  "#B9411C": "#FF7B57",
};

export function darkLayer(svg: string): string {
  return Object.entries(DARK_COLORS).reduce((text, [light, dark]) => text.replaceAll(light, dark), svg);
}

/** `#RRGGBB` → Icon Composer's `srgb:r,g,b,a` with five decimals. */
function srgb(hex: string): string {
  const n = (i: number) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5);
  return `srgb:${n(1)},${n(3)},${n(5)},1.00000`;
}

const fill = (top: string, bottom: string) => ({ "linear-gradient": [srgb(top), srgb(bottom)], orientation: { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 1 } } });

const layer = (name: string) => ({
  name,
  "image-name": `${name}.svg`,
  "image-name-specializations": [{ value: `${name}.svg` }, { appearance: "dark", value: `${name}-dark.svg` }],
});

export function iconJson() {
  return {
    "fill-specializations": [{ value: fill("#F7F2E9", "#E4D9C6") }, { appearance: "dark", value: fill("#2A2420", "#15120F") }],
    groups: [
      { layers: [layer("flame")], shadow: { kind: "neutral", opacity: 0.5 }, translucency: { enabled: false, value: 0.5 } },
      { layers: [layer("hearth")], shadow: { kind: "neutral", opacity: 0.5 }, translucency: { enabled: false, value: 0.5 } },
    ],
    "supported-platforms": { squares: ["macOS"] },
  };
}

/** Icon Composer places a layer at its own size on a 1024-point canvas: the 128-unit layers are drawn at 1024. */
export function fullCanvas(svg: string): string {
  return svg.replace(/^<svg /, '<svg width="1024" height="1024" ');
}

/** The bundle's files, relative to `Vesta.icon/`. */
export function bundleFiles(read: (layer: "hearth" | "flame") => string): Record<string, string> {
  const light = (l: "hearth" | "flame") => fullCanvas(read(l));
  return {
    "icon.json": `${JSON.stringify(iconJson(), null, 2)}\n`,
    "Assets/hearth.svg": light("hearth"),
    "Assets/hearth-dark.svg": darkLayer(light("hearth")),
    "Assets/flame.svg": light("flame"),
    "Assets/flame-dark.svg": darkLayer(light("flame")),
  };
}
