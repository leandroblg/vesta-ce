/**
 * Translations for the renderer and main (007 research §1, contracts/locale-files.md): one i18next instance
 * per caller, from the bundled locale files, English as fallback, single-brace placeholders.
 */
import i18next from "i18next";
import type { Lang } from "../../domain/language";
import en from "./locales/en.json";
import ptBR from "./locales/pt-BR.json";
import it from "./locales/it.json";
import esES from "./locales/es-ES.json";
import fr from "./locales/fr.json";

export const RESOURCES: Readonly<Record<Lang, Readonly<Record<string, string>>>> = Object.freeze({
  en,
  "pt-BR": ptBR,
  it,
  "es-ES": esES,
  fr,
});

type Params = Record<string, string | number>;

export interface Translator {
  t: (key: string, params?: Params) => string;
  changeLanguage: (lang: Lang) => void;
  language: () => Lang;
}

function interpolate(template: string, params: Params): string {
  if (!template.includes("{")) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];

/** True when `lang` has the key itself or, for a plural key, its `_other` form. */
export function hasKey(lang: Lang, key: string): boolean {
  const table = RESOURCES[lang];
  return key in table || PLURAL_SUFFIXES.some((s) => `${key}_${s}` in table);
}

/**
 * `onMissing` is called once per key and language when a string falls back to English or to its key
 * (unpackaged builds report it to the log, research §1).
 */
export function createI18n(lang: Lang, onMissing?: (key: string, lang: Lang) => void): Translator {
  const instance = i18next.createInstance();
  void instance.init({
    resources: Object.fromEntries(Object.entries(RESOURCES).map(([l, table]) => [l, { translation: table }])),
    lng: lang,
    fallbackLng: "en",
    initAsync: false,
    keySeparator: false,
    nsSeparator: false,
    returnNull: false,
    interpolation: { prefix: "{", suffix: "}", escapeValue: false },
  });
  const reported = new Set<string>();
  let active = lang;
  return {
    t: (key, params = {}) => {
      if (onMissing !== undefined && !hasKey(active, key)) {
        const id = `${active}:${key}`;
        if (!reported.has(id)) {
          reported.add(id);
          onMissing(key, active);
        }
      }
      // The fast path: a plain lookup with English fallback and {name} placeholders, as i18next would do.
      // i18next itself only for counted strings (plural rules). Cards call t() several times per render,
      // and i18next's full pipeline made a 1,000-row tick exceed the 003 long-task budget.
      if (params["count"] === undefined) {
        const template = RESOURCES[active][key] ?? RESOURCES.en[key];
        if (template !== undefined) return interpolate(template, params);
      }
      return instance.t(key, params);
    },
    changeLanguage: (next) => {
      active = next;
      void instance.changeLanguage(next);
    },
    language: () => active,
  };
}
