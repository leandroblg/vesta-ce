import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LANGS, LOCALE_TAG, type Lang } from "../../../src/domain/language";

const dir = join(import.meta.dirname, "../../../src/shared/i18n/locales");
const load = (lang: Lang): Record<string, unknown> => JSON.parse(readFileSync(join(dir, `${lang}.json`), "utf8")) as Record<string, unknown>;

const PLURAL = /^(.*)_(zero|one|two|few|many|other)$/;
const base = (k: string) => PLURAL.exec(k)?.[1] ?? k;
const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

const en = load("en") as Record<string, string>;
const enBases = new Set(Object.keys(en).map(base));
const pluralBases = new Set(Object.keys(en).filter((k) => PLURAL.test(k)).map(base));

const ENDONYM: Record<Lang, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
  it: "Italiano",
  "es-ES": "Español (España)",
  fr: "Français",
};
const UNITS: Record<Lang, [string, string, string]> = {
  en: ["d", "h", "m"],
  "pt-BR": ["d", "h", "min"],
  it: ["g", "h", "min"],
  "es-ES": ["d", "h", "min"],
  fr: ["j", "h", "min"],
};

describe.each(LANGS)("locale %s (007 FR-012, FR-019, SC-006; contracts/locale-files.md)", (lang) => {
  const file = load(lang);

  it("is a flat object of non-empty strings with no markup", () => {
    for (const [k, v] of Object.entries(file)) {
      expect(typeof v, k).toBe("string");
      expect((v as string).length, k).toBeGreaterThan(0);
      expect(v as string, k).not.toMatch(/[<>]/);
    }
  });

  it("has exactly English's keys, apart from plural suffixes", () => {
    const bases = new Set(Object.keys(file).map(base));
    expect([...bases].sort()).toEqual([...enBases].sort());
    for (const k of Object.keys(en)) if (!PLURAL.test(k)) expect(file, k).toHaveProperty(k);
  });

  it("uses the same placeholders as English for every key", () => {
    for (const [k, v] of Object.entries(file)) {
      const enText = en[k] ?? en[`${base(k)}_other`];
      expect(enText, k).toBeDefined();
      expect(placeholders(v as string), k).toEqual(placeholders(enText ?? ""));
    }
  });

  it("has a key for every plural category of the language", () => {
    const categories = new Intl.PluralRules(LOCALE_TAG[lang]).resolvedOptions().pluralCategories;
    for (const b of pluralBases) for (const c of categories) expect(file, `${b}_${c}`).toHaveProperty(`${b}_${c}`);
  });

  it("names itself and has the PRD A4 unit letters", () => {
    expect(file["langName"]).toBe(ENDONYM[lang]);
    expect([file["unitD"], file["unitH"], file["unitM"]]).toEqual(UNITS[lang]);
  });
});

describe("012 FR-033 every key added by 012 exists in all five locale files; the removed ones are gone", () => {
  const KEYS_012 = [
    "fmScope_paragraph", "fmScope_heading", "fmScope_listItem", "fmScope_quote", "fmScope_code", "fmScope_cell",
    "fmIndent", "fmIndentHint", "fmSizeUp", "fmSizeDown", "fmTableDelete", "cpRemoveColor", "cpRemoveHighlight",
    // sc_indentItem and sc_outdentItem were replaced by 013's menu labels (FR-048).
  ];
  it.each(LANGS)("FR-033 %s", (lang) => {
    const file = load(lang);
    for (const key of KEYS_012) expect(typeof file[key], `${lang} ${key}`).toBe("string");
    for (const key of ["fmSize", "cpAutomatic"]) expect(file[key], `${lang} ${key}`).toBeUndefined();
  });
});

describe("013 FR-046 every key added by 013 exists in all five locale files; the removed ones are gone", () => {
  const KEYS_013 = [
    "menuNewTask", "menuNewSubtask", "menuNewReminder", "menuExport", "menuImport", "menuFind", "menuSearchEverything",
    "menuMarkDone", "menuMoveToTrash", "menuDeleteForever", "menuAlertPeriod", "menuFormat", "menuView", "menuHelp",
    "menuHeadingN", "menuTable", "menuShowDetails", "menuShowLogs", "confirmDeleteForever", "cancel", "updatesTabMark",
    "aboutTextMac", "aboutTextOther", "aboutLicenseButton", "aboutFootnote", "aboutTitle", "scGroupLists",
  ];
  const REMOVED_013 = [
    "del", "addSub", "details", "settingsUpdateAvailable", "about", "aboutText", "aboutLicense", "viewTasks",
    "confirmDelPress", "sc_newTask", "sc_newSub", "sc_newRem", "sc_search", "sc_open", "sc_done", "sc_del", "sc_settings",
    "sc_undo", "sc_restore", "sc_minimize", "sc_indentItem", "sc_outdentItem",
  ];
  it.each(LANGS)("FR-046 %s", (lang) => {
    const file = load(lang);
    for (const key of KEYS_013) expect(typeof file[key], `${lang} ${key}`).toBe("string");
    for (const key of REMOVED_013) expect(file[key], `${lang} ${key}`).toBeUndefined();
  });
});

describe("FR-028 every key added by 011 exists in all five locale files", () => {
  const KEYS_011 = [
    // cpAutomatic was removed by 012 (PRD Q154).
    "cpCustom", "cpPreset", "cpPinned", "cpRecent", "cpRecentEmpty", "cpUnpin", "cpPinHint", "cpAdjusted", "cpSwatch",
    "hueRed", "hueOrange", "hueAmber", "hueLime", "hueGreen", "hueTeal", "hueSky", "hueBlue", "hueViolet", "huePink",
    "hueWhite", "hueGray", "hueBlack",
    "fmMergeHint", "fmTableHint", "fmRowAbove", "fmRowBelow", "fmColLeft", "fmColRight", "fmRowDelete", "fmColDelete",
    "tsDialog", "tsSizeWH", "tsSizeHW", "tsSpokenWH", "tsSpokenHW", "tsCols", "tsRows", "tsInsert", "tsRange", "tsChooseHint",
    "tableRowsFirst", "keyReturn", "keySpokenReturn",
  ];
  it.each(LANGS)("FR-028 %s has every 011 key", (lang) => {
    const file = load(lang);
    for (const key of KEYS_011) expect(file[key], `${lang}.${key}`).toEqual(expect.any(String));
    expect(placeholders(file["editHint"] as string)).toEqual(["enter"]);
  });
});

// 013 FR-012 (T111): the floating menu's buttons and the table handles keep their own keys, with the menu bar's words.
const FM_MENU: readonly [string, string][] = [
  ["fmBold", "menuBold"], ["fmItalic", "menuItalic"], ["fmUnderline", "menuUnderline"], ["fmStrike", "menuStrikethrough"],
  ["fmCode", "menuCode"], ["fmHighlight", "menuHighlight"], ["fmColor", "menuTextColor"], ["fmHighlightColor", "menuHighlightColor"],
  ["fmSizeUp", "menuSizeUp"], ["fmSizeDown", "menuSizeDown"], ["fmHeading", "menuHeading"], ["fmBullet", "menuBulletedList"],
  ["fmOrdered", "menuNumberedList"], ["fmCheck", "menuChecklist"], ["fmIndent", "menuIndent"], ["fmQuote", "menuQuote"],
  ["fmCodeBlock", "menuCodeBlock"], ["fmHr", "menuDivider"], ["fmTable", "menuTable"], ["fmRowAbove", "menuRowAbove"],
  ["fmRowBelow", "menuRowBelow"], ["fmColLeft", "menuColLeft"], ["fmColRight", "menuColRight"], ["fmRowDelete", "menuRowDelete"],
  ["fmColDelete", "menuColDelete"], ["fmTableDelete", "menuTableDelete"], ["fmLink", "menuLink"], ["fmInsert", "menuInsertFile"],
];
const words = (s: string) => s.replace(/…$/, "").trim().toLowerCase();

describe("013 FR-012 FR-011 the menu's words on the other surfaces, in each language's case", () => {
  it.each(LANGS)("%s: every floating-menu button reads as its Format item, without the ellipsis", (lang) => {
    const table = load(lang) as Record<string, string>;
    for (const [fm, menu] of FM_MENU) {
      expect(table[fm], `${lang} ${fm}`).toBeDefined();
      expect(words(table[fm] ?? ""), `${lang} ${fm} / ${menu}`).toBe(words(table[menu] ?? ""));
      expect(table[fm], `${lang} ${fm}`).not.toMatch(/…$/);
    }
  });

  it.each(LANGS.filter((l) => l !== "en"))("%s: menu labels are in sentence case (no capital after the first word, Vesta aside)", (lang) => {
    const table = load(lang) as Record<string, string>;
    for (const [key, value] of Object.entries(table)) {
      if (!key.startsWith("menu")) continue;
      const later = value.split(/\s+/).slice(1).filter((w) => w !== "Vesta" && /^\p{Lu}/u.test(w));
      expect(later, `${lang} ${key}: ${value}`).toEqual([]);
    }
  });
});

describe("015 every key added by 015 exists in all five locale files; the removed ones are gone", () => {
  const KEYS_015 = [
    "history", "createdAt", "histCreated", "histStale", "histUnstale", "histRescheduled", "histRescheduledFor",
    "histOverrideSet", "histOverrideChanged", "histOverrideCleared", "histDone", "histTrashed", "histRestored", "histWasStale",
    "quickDurations", "quickHelp", "quickFirst", "quickSecond", "quickThird", "quickFourth", "menuPostponeFor",
    "scPostpone1", "scPostpone2", "scPostpone3", "scPostpone4", "aboutLicenseTitle", "aboutThirdParty",
    "aboutThirdPartyTitle", "thirdPartyMissing",
  ];
  const REMOVED_015 = ["histYes", "histNo", "aboutBack", "aboutLicenseText"];
  it.each(LANGS)("%s", (lang) => {
    const file = load(lang);
    for (const key of KEYS_015) expect(typeof file[key], `${lang} ${key}`).toBe("string");
    for (const key of REMOVED_015) expect(file[key], `${lang} ${key}`).toBeUndefined();
  });
});

describe("016 FR-034, FR-040 every key added by 016 exists in all five locale files; no limit text says 720", () => {
  const KEYS_016 = [
    "toastRescheduled", "toastReschedUndone", "redoLink", "linkText", "linkHref", "linkApply", "linkRemove",
    "linkRefused", "linkUnsafe", "ctxLinkMenu", "ctxCopy", "ctxCopyLink", "ctxOpenLink", "ctxRevealMac",
    "ctxRevealWin", "ctxRevealLinux", "menuCopyLink", "dialogMoveHint",
  ];
  it.each(LANGS)("%s", (lang) => {
    const file = load(lang);
    for (const key of KEYS_016) expect(typeof file[key], `${lang} ${key}`).toBe("string");
    for (const key of ["reblinkHelp", "toleranceHelp", "quickHelp"]) expect(file[key], `${lang} ${key}`).not.toMatch(/720/);
    // The link prompt's placeholder and name went with the prompt (FR-013).
    for (const key of ["fmLinkPh", "fmLinkLabel"]) expect(file[key], `${lang} ${key}`).toBeUndefined();
  });
});

describe("017 FR-015a every key added by 017 exists in all five locale files", () => {
  const KEYS_017 = ["noticeNewerData", "dataRefusedNewer"];
  it.each(LANGS)("%s", (lang) => {
    const file = load(lang);
    for (const key of KEYS_017) expect(typeof file[key], `${lang} ${key}`).toBe("string");
  });
});

describe("018 FR-032 every key added by 018 exists in all five locale files, with the same placeholders", () => {
  /** Grows with each user story of 018 (tasks.md T011, T020, T036, T056, T063). */
  const KEYS_018: readonly string[] = ["editionMark", "editionName", "editionLine", "aboutTrademark", "trademarkNotice", "deleteBtn", "deleteItem",
    "cleanupHeading", "cleanupArchive", "cleanupTrash", "cleanupArchiveOn", "cleanupTrashOn", "cleanupArchiveHelp",
    "cleanupTrashHelp", "cleanupLimits", "cleanupCountdown", "years", "confirmCleanupArchive_one", "confirmCleanupArchive_other",
    "confirmCleanupTrash_one", "confirmCleanupTrash_other", "confirmCleanupDetail", "confirmCleanupButton", "confirmTrashOff",
    "confirmTrashOffDetail", "confirmTrashOffButton", "trashNote", "trashNoteOff", "archiveNote", "archiveNoteOff", "emptyTrash",
    "emptyTrashOff", "emptyArchive", "emptyArchiveOff", "timeLeft", "yearsN_one", "yearsN_other", "daysN_one", "daysN_other",
    "hoursN_one", "hoursN_other", "sc_close"];
  it.each(LANGS)("%s", (lang) => {
    const file = load(lang) as Record<string, string>;
    for (const key of KEYS_018) {
      expect(typeof file[key], `${lang} ${key}`).toBe("string");
      expect(placeholders(file[key] ?? ""), `${lang} ${key}`).toEqual(placeholders(en[key] ?? ""));
    }
  });

  it.each(LANGS)("%s: the edition is never translated, and no other text names it CE (FR-004, SC-001, Q284)", (lang) => {
    const file = load(lang);
    expect(file["editionMark"]).toBe("CE");
    expect(file["editionName"]).toBe(" Community Edition");
    expect(file["editionLine"]).toBe("Community Edition");
    for (const [key, value] of Object.entries(file)) {
      if (key === "editionMark" || typeof value !== "string") continue;
      // Running text may write the edition out as "Vesta CE" (SC-001); "CE" alone names nothing else.
      expect(value, `${lang} ${key}`).not.toMatch(/(?<!Vesta )\bCE\b/);
    }
  });
});
