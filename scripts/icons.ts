/**
 * 017 FR-011 (research §3): the app icon set, from build/icon/, with macOS's own tools (sips renders the SVG at each
 * size, iconutil makes the .icns, actool checks the Icon Composer bundle). Writes build/icons/<n>x<n>.png (Linux),
 * build/icon.icns and build/Vesta.icon (macOS) and build/icon.ico (Windows); all ignored by git.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bundleFiles } from "./lib/icon-composer.ts";
import { writeIco } from "./lib/ico.ts";

export const ICON_FALLBACK_MESSAGE = "Icon Composer bundle rejected by actool: macOS gets the Default appearance only.\n";

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** iconutil's names: icon_<n>x<n>.png and icon_<n>x<n>@2x.png for 16, 32, 128, 256 and 512. */
const ICONSET: readonly [string, number][] = [16, 32, 128, 256, 512].flatMap((n): [string, number][] => [
  [`icon_${String(n)}x${String(n)}.png`, n],
  [`icon_${String(n)}x${String(n)}@2x.png`, n * 2],
]);

export function renderPng(svg: string, size: number, out: string): void {
  execFileSync("sips", ["-z", String(size), String(size), "-s", "format", "png", svg, "--out", out], { stdio: "ignore" });
}

/**
 * build/Vesta.icon, compiled once with actool as electron-builder will (macosIconComposer.js). Returns false when
 * actool rejects it: macOS then gets build/icon.icns, the Default appearance only.
 */
export function writeIconComposer(root: string): boolean {
  const build = join(root, "build");
  const bundle = join(build, "Vesta.icon");
  rmSync(bundle, { recursive: true, force: true });
  const files = bundleFiles((layer) => readFileSync(join(build, "icon", `${layer}.svg`), "utf8"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(bundle, name)), { recursive: true });
    writeFileSync(join(bundle, name), text);
  }
  const probe = mkdtempSync(join(tmpdir(), "vesta-actool-"));
  try {
    const args = ["actool", bundle, "--compile", probe, "--output-partial-info-plist", join(probe, "info.plist"), "--app-icon", "Vesta"];
    args.push("--include-all-app-icons", "--enable-on-demand-resources", "NO", "--development-region", "en", "--target-device", "mac");
    args.push("--minimum-deployment-target", "26.0", "--platform", "macosx");
    execFileSync("xcrun", args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

/** Every icon file; returns whether macOS gets the four-appearance Icon Composer icon. */
export function writeIcons(root: string): boolean {
  const build = join(root, "build");
  const svg = join(build, "icon", "icon.svg");
  const pngDir = join(build, "icons");
  rmSync(pngDir, { recursive: true, force: true });
  mkdirSync(pngDir, { recursive: true });
  const pngPath = (n: number) => join(pngDir, `${String(n)}x${String(n)}.png`);
  for (const n of PNG_SIZES) renderPng(svg, n, pngPath(n));

  const iconset = join(build, "icon.iconset");
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset);
  for (const [name, n] of ICONSET) writeFileSync(join(iconset, name), readFileSync(pngPath(n)));
  execFileSync("iconutil", ["-c", "icns", "-o", join(build, "icon.icns"), iconset], { stdio: "ignore" });
  rmSync(iconset, { recursive: true, force: true });

  writeFileSync(join(build, "icon.ico"), writeIco(ICO_SIZES.map((size) => ({ size, png: readFileSync(pngPath(size)) }))));
  return writeIconComposer(root);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const composer = writeIcons(resolve(import.meta.dirname, ".."));
    process.stdout.write(`Wrote build/icons/, build/icon.icns, build/icon.ico${composer ? " and build/Vesta.icon" : ""}.\n`);
    if (!composer) process.stdout.write(ICON_FALLBACK_MESSAGE);
  } catch (err) {
    process.stderr.write(`Icons: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
