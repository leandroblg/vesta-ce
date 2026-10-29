import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssetError } from "../../../src/main/assets/store";
import { openAsset, revealAsset } from "../../../src/main/assets/open";
import { resolveAssetUrl } from "../../../src/main/assets/resolve";
import { tempDir } from "../db/helpers";

const HASH = "0123456789abcdef".repeat(4);
const ALLOWED = ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "md", "csv", "json", "mp3", "wav", "mp4", "mov", "docx", "xlsx", "pptx"];
const SHOWN = [
  "jar", "py", "pyw", "rb", "pl", "php", "hta", "wsf", "wsh", "vbe", "jse", "reg", "inf", "scf", "pif", "cpl", "msc", "msp", "url",
  "webloc", "scpt", "workflow", "terminal", "jnlp", "psm1", "dmg", "iso", "chm", "docm", "xlsm", "pptm", "html", "htm", "xhtml", "svg",
  "mht", "exe", "bat", "cmd", "com", "msi", "ps1", "vbs", "js", "scr", "lnk", "app", "command", "pkg", "tool", "sh", "run", "bin",
  "appimage", "desktop",
];

describe("M4 opening a stored file uses the allow-list (010 FR-006, PRD Q129)", () => {
  let dir: string;
  let cleanup: () => void;
  let opened: string[];
  let shown: string[];
  let rows: Map<string, { ext: string }>;
  const deps = (platform: NodeJS.Platform = "linux") => ({
    dir,
    shell: {
      openPath: (p: string) => {
        opened.push(p);
        return Promise.resolve("");
      },
      showItemInFolder: (p: string) => {
        shown.push(p);
      },
      openExternal: () => Promise.resolve(),
    },
    find: (sha256: string) => rows.get(sha256) ?? null,
    platform,
  });
  const put = (ext: string, mode?: number) => {
    const file = ext === "" ? HASH : `${HASH}.${ext}`;
    writeFileSync(join(dir, "assets", file), "x");
    if (mode !== undefined) chmodSync(join(dir, "assets", file), mode);
    rows.set(HASH, { ext });
    return join(dir, "assets", file);
  };

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    mkdirSync(join(dir, "assets"));
    opened = [];
    shown = [];
    rows = new Map();
  });
  afterEach(() => {
    cleanup();
  });

  it.each(ALLOWED)("M4 %s opens with the default application", (ext) => {
    const path = put(ext);
    expect(openAsset(`assets/${HASH}.${ext}`, deps())).toBe("opened");
    expect(opened).toEqual([path]);
    expect(shown).toEqual([]);
  });

  it.each(SHOWN)("M4 %s is shown in the file manager and never launched", (ext) => {
    const path = put(ext);
    expect(openAsset(`assets/${HASH}.${ext}`, deps())).toBe("shown");
    expect(shown).toEqual([path]);
    expect(opened).toEqual([]);
  });

  it("M4 a file without an extension is shown, not opened", () => {
    const path = put("");
    expect(openAsset(`assets/${HASH}`, deps())).toBe("shown");
    expect(shown).toEqual([path]);
  });

  it("M4 keeps 005's execute-bit rule: an allow-listed pdf with mode 755 is shown on Unix", () => {
    const path = put("pdf", 0o755);
    expect(openAsset(`assets/${HASH}.pdf`, deps("darwin"))).toBe("shown");
    expect(shown).toEqual([path]);
    expect(openAsset(`assets/${HASH}.pdf`, deps("win32"))).toBe("opened"); // Windows has no execute bit
  });

  it("M4 the corpus covers at least 50 names", () => {
    expect(ALLOWED.length + SHOWN.length + 1).toBeGreaterThanOrEqual(50);
  });

  it("a missing file is NOT_FOUND (005 FR-033, kept)", () => {
    rows.set(HASH, { ext: "pdf" });
    let code: string | null = null;
    try {
      openAsset(`assets/${HASH}.pdf`, deps());
    } catch (err) {
      code = err instanceof AssetError ? err.code : "other";
    }
    expect(code).toBe("NOT_FOUND");
  });

  it("016 FR-016b a stored file that is a link leading out of the stored-files folder is refused, and warned about", () => {
    const outside = join(dir, "secret.pdf");
    writeFileSync(outside, "secret");
    symlinkSync(outside, join(dir, "assets", `${HASH}.pdf`));
    rows.set(HASH, { ext: "pdf" });
    const warned: string[] = [];
    let code: string | null = null;
    try {
      openAsset(`assets/${HASH}.pdf`, { ...deps(), warn: (m: string) => { warned.push(m); } });
    } catch (err) {
      code = err instanceof AssetError ? err.code : "other";
    }
    expect(code).toBe("NOT_FOUND");
    expect(opened).toEqual([]);
    expect(shown).toEqual([]);
    expect(warned).toEqual(["asset.outside"]);
    expect(resolveAssetUrl(`vesta-asset://assets/${HASH}.pdf`, { dir, find: () => ({ ext: "pdf", mimeType: "application/pdf" }) })).toBeNull();
    expect(() => {
      revealAsset(`assets/${HASH}.pdf`, deps());
    }).toThrow(AssetError);
  });

  it("016 FR-016a Show in Finder reveals the stored copy of any type, never opening it", () => {
    const path = put("zip");
    revealAsset(`assets/${HASH}.zip`, deps());
    expect(shown).toEqual([path]);
    expect(opened).toEqual([]);
    expect(() => {
      revealAsset("/etc/passwd", deps());
    }).toThrow(AssetError);
  });
});

