import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DARK_COLORS, darkLayer, iconJson } from "../../../scripts/lib/icon-composer.ts";

const layers = resolve(import.meta.dirname, "../../../build/icon");

describe("Icon Composer bundle (017 FR-011, research §3, app icon notes)", () => {
  const json = iconJson();

  it("is JSON with the ground as the fill and the flame above the hearth ring", () => {
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    const names = json.groups.map((g) => g.layers.map((l) => l["image-name"]));
    expect(names).toEqual([["flame.svg"], ["hearth.svg"]]);
  });

  it("gives Dark its basalt ground and its own ring and flame", () => {
    expect(json["fill-specializations"]).toHaveLength(2);
    expect(json["fill-specializations"][1]?.appearance).toBe("dark");
    const dark = json.groups.flatMap((g) => g.layers.map((l) => l["image-name-specializations"].find((s) => s.appearance === "dark")?.value));
    expect(dark).toEqual(["flame-dark.svg", "hearth-dark.svg"]);
  });

  it("recolors the hearth ring gold and the flame brighter for Dark, as icon-dark.svg draws them", () => {
    const hearth = darkLayer(readFileSync(`${layers}/hearth.svg`, "utf8"));
    expect(hearth).toContain("#C89A52");
    expect(hearth).toContain("#A47D3F");
    expect(hearth).not.toContain("#8A6A3A");
    const flame = darkLayer(readFileSync(`${layers}/flame.svg`, "utf8"));
    for (const c of ["#FFD27A", "#F0A14A", "#FF7B57"]) expect(flame).toContain(c);
    const darkSvg = readFileSync(`${layers}/icon-dark.svg`, "utf8");
    for (const c of Object.values(DARK_COLORS)) expect(darkSvg).toContain(c);
  });
});
