// 011 US6 (FR-031 to FR-033, SC-009): on macOS every text names the Enter key Return; elsewhere Enter.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LANGS, type Lang } from "../../../src/domain/language";
import { enterKey, keyNames, setLanguage, shiftEnterKey, spokenKeyNames, t } from "../../../src/renderer/i18n/t";

const dir = join(import.meta.dirname, "../../../src/shared/i18n/locales");
const load = (lang: Lang) => JSON.parse(readFileSync(join(dir, `${lang}.json`), "utf8")) as Record<string, string>;
/** Each language's word for the Enter key, as its PC keyboard names it. */
const ENTER_WORD: Record<Lang, string> = { en: "Enter", "pt-BR": "Enter", it: "Invio", "es-ES": "Intro", fr: "Entrée" };
const HINTS = ["editHint", "cpPinHint", "fmMergeHint", "fmTableHint", "tsChooseHint"] as const;

afterEach(() => {
  setLanguage("en");
});

describe("FR-031 FR-032 the key's name by platform", () => {
  it.each(LANGS)("FR-031 %s: Return on macOS, Enter elsewhere, in words and spoken", (lang) => {
    setLanguage(lang);
    const file = load(lang);
    expect(keyNames(true).enter).toBe(file["keyReturn"]);
    expect(spokenKeyNames(true).enter).toBe(file["keySpokenReturn"]);
    expect(keyNames(false).enter).toBe(file["keyEnter"]);
    expect(spokenKeyNames(false).enter).toBe(file["keySpokenEnter"]);
  });

  it.each(LANGS)("FR-032 SC-009 the existing texts and every 011 text name Return on macOS (%s)", (lang) => {
    setLanguage(lang);
    const word = new RegExp(`\\b${ENTER_WORD[lang]}\\b`, "u");
    for (const key of HINTS) {
      const mac = t(key, { enter: enterKey(true), shiftEnter: shiftEnterKey(true), shift: t("keyShift") });
      const pc = t(key, { enter: enterKey(false), shiftEnter: shiftEnterKey(false), shift: t("keyShift") });
      if (ENTER_WORD[lang] !== keyNames(true).enter) expect(mac, `${lang}.${key}`).not.toMatch(word);
      expect(mac, `${lang}.${key}`).toContain(keyNames(true).enter);
      expect(pc, `${lang}.${key}`).toContain(keyNames(false).enter);
    }
  });

  it.each(LANGS)("SC-009 no %s value names the Enter key literally outside the two key entries", (lang) => {
    const file = load(lang);
    const word = new RegExp(`(?<![\\p{L}])${ENTER_WORD[lang]}(?![\\p{L}])`, "u");
    const hits = Object.entries(file).filter(([k, v]) => !["keyEnter", "keySpokenEnter", "keyReturn", "keySpokenReturn"].includes(k) && word.test(v.replace(/\{\w+\}/g, "")));
    expect(hits).toEqual([]);
  });
});
