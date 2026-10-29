import { describe, expect, it } from "vitest";
import { LANGS, LOCALE_TAG, resolveLanguage } from "../../../src/domain/language";

describe("resolveLanguage (007 FR-014, FR-016; Clarifications)", () => {
  it("returns a picked language whatever the OS list", () => {
    expect(resolveLanguage("fr", ["en-US"])).toBe("fr");
    expect(resolveLanguage("pt-BR", [])).toBe("pt-BR");
  });

  it.each([
    [["de-DE", "fr-FR"], "fr"],
    [["pt-PT"], "pt-BR"],
    [["es-419"], "es-ES"],
    [["en_GB"], "en"],
    [["it-CH"], "it"],
    [["zh-Hans-CN", "ja"], "en"],
    [[], "en"],
    [["FR-ca"], "fr"],
  ] as const)("with Use system language, %j gives %s", (list, expected) => {
    expect(resolveLanguage("system", list)).toBe(expected);
  });

  it("lists the languages in FR-013 order, with their BCP 47 tags for dates", () => {
    expect(LANGS).toEqual(["en", "pt-BR", "it", "es-ES", "fr"]);
    expect(LOCALE_TAG).toEqual({ en: "en-US", "pt-BR": "pt-BR", it: "it-IT", "es-ES": "es-ES", fr: "fr-FR" });
  });
});
