/** The shipped languages and the OS-language rule (007 FR-012 to FR-016, research §3). */

export type Lang = "en" | "pt-BR" | "it" | "es-ES" | "fr";
export type LanguageSetting = "system" | Lang;

/** FR-013 order: the order of the Settings list after "Use system language". */
export const LANGS: readonly Lang[] = ["en", "pt-BR", "it", "es-ES", "fr"];

/** The BCP 47 tag each language formats dates and times with (research §5). */
export const LOCALE_TAG: Readonly<Record<Lang, string>> = Object.freeze({
  en: "en-US",
  "pt-BR": "pt-BR",
  it: "it-IT",
  "es-ES": "es-ES",
  fr: "fr-FR",
});

const BY_PRIMARY: Readonly<Record<string, Lang>> = { en: "en", pt: "pt-BR", it: "it", es: "es-ES", fr: "fr" };

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return value === "system" || (typeof value === "string" && (LANGS as readonly string[]).includes(value));
}

/**
 * A picked language wins. With Use system language, the first OS-preferred language Vesta supports, matched
 * by its primary subtag (region ignored); English when none is (Clarifications).
 */
export function resolveLanguage(setting: LanguageSetting, osPreferred: readonly string[]): Lang {
  if (setting !== "system") return setting;
  for (const tag of osPreferred) {
    const primary = tag.split(/[-_]/)[0]?.toLowerCase() ?? "";
    const lang = BY_PRIMARY[primary];
    if (lang !== undefined) return lang;
  }
  return "en";
}
