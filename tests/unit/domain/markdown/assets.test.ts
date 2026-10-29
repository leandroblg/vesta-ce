import { describe, expect, it } from "vitest";
import {
  assetRefs,
  isAssetRef,
  isExecutable,
  sniffImage,
  storedExtension,
  OPENABLE,
  assetMimeType,
  isOpenable,
} from "../../../../src/domain/markdown/assets";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

describe("assetRefs (FR-032, FR-032a)", () => {
  it("finds stored files in image and link targets", () => {
    const md = `![photo](assets/${A}.png) and [report.pdf](assets/${B}.pdf)`;
    expect(assetRefs(md)).toEqual([`assets/${A}.png`, `assets/${B}.pdf`]);
  });

  it("finds a stored file without an extension", () => {
    expect(assetRefs(`[file](assets/${A})`)).toEqual([`assets/${A}`]);
  });

  it("finds stored files in spans, lists, tables and HTML", () => {
    const md = [
      `[![x](assets/${A}.png)]{color="#dd3333"}`,
      "",
      `- [y](assets/${B}.txt)`,
      "",
      "| a |",
      "| --- |",
      `| ![z](assets/${C}.gif) |`,
      "",
      `<img src="assets/${A}.webp" alt="h">`,
    ].join("\n");
    expect(assetRefs(md)).toEqual([`assets/${A}.png`, `assets/${B}.txt`, `assets/${C}.gif`, `assets/${A}.webp`]);
  });

  it("finds stored files in reference definitions", () => {
    expect(assetRefs(`[x][r]\n\n[r]: assets/${A}.pdf`)).toEqual([`assets/${A}.pdf`]);
  });

  it("ignores references in code spans and code blocks", () => {
    const md = `\`![x](assets/${A}.png)\`\n\n\`\`\`\n![y](assets/${B}.png)\n\`\`\``;
    expect(assetRefs(md)).toEqual([]);
  });

  it("ignores targets that are not stored files", () => {
    expect(
      assetRefs(`[x](https://example.com/assets/${A}.png) ![y](assets/../${A}.png) [z](assets/${A.toUpperCase()})`),
    ).toEqual([]);
  });

  it("dedupes, keeping the first order", () => {
    expect(assetRefs(`![a](assets/${A}.png) [b](assets/${B}) ![c](assets/${A}.png)`)).toEqual([
      `assets/${A}.png`,
      `assets/${B}`,
    ]);
  });

  it("gives nothing for empty input", () => {
    expect(assetRefs("")).toEqual([]);
  });
});

describe("isAssetRef", () => {
  it("matches stored file references only", () => {
    expect(isAssetRef(`assets/${A}.png`)).toBe(true);
    expect(isAssetRef(`assets/${A}`)).toBe(true);
    expect(isAssetRef(`assets/${A}.${"x".repeat(16)}`)).toBe(true);
    expect(isAssetRef(`assets/${A}.${"x".repeat(17)}`)).toBe(false);
    expect(isAssetRef("assets/../x")).toBe(false);
    expect(isAssetRef(`assets/${A.toUpperCase()}.png`)).toBe(false);
    expect(isAssetRef(`assets/${"a".repeat(63)}.png`)).toBe(false);
    expect(isAssetRef(`assets/${A}.PNG`)).toBe(false);
    expect(isAssetRef(`/assets/${A}.png`)).toBe(false);
    expect(isAssetRef(`assets/${A}.png/x`)).toBe(false);
  });
});

describe("storedExtension (data-model assets.ext)", () => {
  it.each([
    ["photo.PNG", "png"],
    ["archive.tar.gz", "gz"],
    ["no-extension", ""],
    [".bashrc", "bashrc"],
    ["weird.p-n_g", "png"],
    ["x.ÄÖ", ""],
    [`x.${"a".repeat(17)}`, ""],
    [`x.${"a".repeat(16)}`, "a".repeat(16)],
    ["trailing.", ""],
  ])("%s gives %j", (name, ext) => {
    expect(storedExtension(name)).toBe(ext);
  });
});

describe("sniffImage (FR-027)", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const ascii = (s: string) => new TextEncoder().encode(s);

  it("recognizes PNG, JPEG, GIF and WebP", () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImage(ascii("GIF87a...."))).toBe("image/gif");
    expect(sniffImage(ascii("GIF89a...."))).toBe("image/gif");
    expect(sniffImage(ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("image/webp");
  });

  it("refuses SVG, PDF, other RIFF files and empty input", () => {
    expect(sniffImage(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImage(ascii("%PDF-1.7"))).toBeNull();
    expect(sniffImage(ascii("RIFF\u0000\u0000\u0000\u0000WAVEfmt "))).toBeNull();
    expect(sniffImage(bytes())).toBeNull();
    expect(sniffImage(bytes(0x89, 0x50))).toBeNull();
  });
});

describe("isExecutable (FR-031)", () => {
  it.each([
    "setup.exe",
    "run.bat",
    "x.cmd",
    "x.com",
    "x.msi",
    "x.ps1",
    "x.vbs",
    "x.js",
    "x.scr",
    "x.lnk",
    "Tool.app",
    "x.command",
    "x.pkg",
    "x.tool",
    "x.sh",
    "x.run",
    "x.bin",
    "x.AppImage",
    "x.desktop",
    "SETUP.EXE",
  ])("%s is executable", (name) => {
    expect(isExecutable(name)).toBe(true);
  });

  it.each(["report.pdf", "photo.png", "notes.txt", "noext", "sh"])("%s is not", (name) => {
    expect(isExecutable(name)).toBe(false);
  });
});

describe("M4 isOpenable and M2 assetMimeType (010 FR-004, FR-006, research §4)", () => {
  const ALLOWED = ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "md", "csv", "json", "mp3", "wav", "mp4", "mov", "docx", "xlsx", "pptx"];
  const AUDIT_MISSING = [
    "jar", "py", "pyw", "rb", "pl", "php", "hta", "wsf", "wsh", "vbe", "jse", "reg", "inf", "scf", "pif", "cpl", "msc", "msp",
    "url", "webloc", "scpt", "workflow", "terminal", "jnlp", "psm1", "dmg", "iso", "chm", "docm", "xlsm", "pptm", "html", "htm",
    "xhtml", "svg", "mht",
  ];
  const EXECUTABLES_005 = ["exe", "bat", "cmd", "com", "msi", "ps1", "vbs", "js", "scr", "lnk", "app", "command", "pkg", "tool", "sh", "run", "bin", "appimage", "desktop"];

  it.each(ALLOWED)("M4 opens %s with the default application", (ext) => {
    expect(isOpenable(`${"a".repeat(64)}.${ext}`)).toBe(true);
    expect(isOpenable(`${"a".repeat(64)}.${ext.toUpperCase()}`)).toBe(true);
  });

  it.each([...AUDIT_MISSING, ...EXECUTABLES_005])("M4 shows %s in the file manager instead", (ext) => {
    expect(isOpenable(`${"a".repeat(64)}.${ext}`)).toBe(false);
  });

  it("M4 never opens a file without an extension", () => {
    expect(isOpenable("a".repeat(64))).toBe(false);
    expect(isOpenable("")).toBe(false);
  });

  it("M4 names the allow-list exactly (spec FR-006)", () => {
    expect([...OPENABLE].sort()).toEqual([...ALLOWED].sort());
  });

  it("M2 assetMimeType trusts the bytes for images, then the extension, then falls back", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(assetMimeType(png, "jpg")).toBe("image/png");
    expect(assetMimeType(new TextEncoder().encode("%PDF-1.4 ....."), "pdf")).toBe("application/pdf");
    expect(assetMimeType(new TextEncoder().encode("<html>"), "html")).toBe("application/octet-stream");
    expect(assetMimeType(new Uint8Array(0), "")).toBe("application/octet-stream");
    expect(assetMimeType(new TextEncoder().encode("hello"), "txt")).toBe("text/plain");
  });
});
