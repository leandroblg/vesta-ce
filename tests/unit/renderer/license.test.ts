// 013 T002 (research §0, FR-029): the AGPL-3.0 text bundled for the About window.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const text = readFileSync(join(import.meta.dirname, "../../../LICENSE"), "utf8");

describe("013 FR-029 LICENSE", () => {
  it("is the GNU AGPL version 3 text, from its title to the end of its terms", () => {
    expect(text.trimStart().startsWith("GNU AFFERO GENERAL PUBLIC LICENSE")).toBe(true);
    expect(text).toContain("Version 3, 19 November 2007");
    expect(text).toContain("END OF TERMS AND CONDITIONS");
    expect(text.split("\n").length).toBeGreaterThan(600);
  });
});

describe("018 FR-021, FR-022 the license text is unchanged and TRADEMARKS.md reserves the name and identity", () => {
  it("LICENSE is byte for byte the committed file", () => {
    const committed = execFileSync("git", ["show", "HEAD:LICENSE"], { cwd: join(import.meta.dirname, "../../.."), encoding: "buffer" });
    expect(readFileSync(join(import.meta.dirname, "../../../LICENSE")).equals(committed)).toBe(true);
  });

  it("TRADEMARKS.md names the owner, the year, what is reserved, the license and where its use is authorized", () => {
    const notice = readFileSync(join(import.meta.dirname, "../../../TRADEMARKS.md"), "utf8");
    expect(notice.startsWith("# ")).toBe(true);
    for (const phrase of [
      "Leandro Gonçalves",
      "2026",
      "All rights reserved",
      "name",
      "logo",
      "visual identity",
      "vesta.tools",
      "AGPL-3.0",
      "Vesta CE",
      "official project",
      // PRD Q293: the edition names are authorized, "Vesta" alone is not, and a modified version may not use it.
      "Vesta Community Edition",
      "section 7(e)",
      "https://github.com/leandroblg/vesta-ce",
      "“Vesta” alone",
      "modified version",
    ])
      expect(notice, phrase).toContain(phrase);
  });

  it("PRD Q293 every translated notice keeps the edition names, the repository, the domain, the year and section 7(e)", () => {
    for (const lang of ["en", "pt-BR", "es-ES", "fr", "it"]) {
      const strings = JSON.parse(
        readFileSync(join(import.meta.dirname, `../../../src/shared/i18n/locales/${lang}.json`), "utf8"),
      ) as Record<string, string>;
      const notice = strings["trademarkNotice"] ?? "";
      for (const phrase of ["Vesta CE", "Vesta Community Edition", "https://github.com/leandroblg/vesta-ce", "vesta.tools", "2026", "7(e)"])
        expect(notice, `${lang}: ${phrase}`).toContain(phrase);
      expect(notice.split("\n\n"), `${lang}: two paragraphs, as TRADEMARKS.md`).toHaveLength(2);
    }
    const english = readFileSync(join(import.meta.dirname, "../../../TRADEMARKS.md"), "utf8").replace(/^# [^\n]*\n+/, "").trim();
    const en = JSON.parse(readFileSync(join(import.meta.dirname, "../../../src/shared/i18n/locales/en.json"), "utf8")) as Record<string, string>;
    expect(en["trademarkNotice"]).toBe(english);
  });
});
