/** Translation lookup for the renderer, on the shared i18next setup (007 research §1, §4, §5). */
import { splitHours } from "../../domain/cleanup";
import type { AgeUnits } from "../../domain/age";
import { isMacPlatform } from "../platform";
import { LOCALE_TAG, type Lang } from "../../domain/language";
import type { KeyNames } from "../../domain/shortcuts/combo";
import { createI18n } from "../../shared/i18n";
import en from "../../shared/i18n/locales/en.json";

/** An English key, with plural keys (`daysLeft_one`, `daysLeft_other`) named by their base (`daysLeft`). */
type PluralBase<K extends string> = K extends `${infer B}_${"zero" | "one" | "two" | "few" | "many" | "other"}` ? B : K;
export type MessageKey = PluralBase<keyof typeof en>;

let missingReporter: ((key: string, lang: Lang) => void) | null = null;

/** Unpackaged builds report a string that falls back to English or to its key (research §1). */
export function reportMissingKeys(fn: (key: string, lang: Lang) => void): void {
  missingReporter = fn;
}

const translator = createI18n("en", (key, lang) => {
  missingReporter?.(key, lang);
});

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return translator.t(key, params);
}

/** Switches every later `t()`; the store re-renders the views (research §4). */
export function setLanguage(lang: Lang): void {
  translator.changeLanguage(lang);
}

export function currentLanguage(): Lang {
  return translator.language();
}

/** Age-unit letters of the current language, never hard-coded (003 FR-013, 007 FR-018). */
export function ageUnits(): AgeUnits {
  return { d: t("unitD"), h: t("unitH"), m: t("unitM") };
}

/** Date and time in local time, formatted for the app language (007 FR-018, research §5). */
export function formatDate(ts: number): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[currentLanguage()], { dateStyle: "medium" }).format(new Date(ts));
}

export function formatTime(ts: number): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[currentLanguage()], { timeStyle: "short" }).format(new Date(ts));
}

/** Key names for shortcut notation, from the locale file (007 FR-033). */
/** `isMac` (011 FR-031): the Enter key is named Return on macOS. */
export function keyNames(isMac = isMacPlatform()): KeyNames {
  return {
    cmd: t("keyCmd"),
    ctrl: t("keyCtrl"),
    shift: t("keyShift"),
    alt: t("keyAlt"),
    option: t("keyOption"),
    enter: isMac ? t("keyReturn") : t("keyEnter"),
    esc: t("keyEsc"),
    delete: t("keyDelete"),
    backspace: t("keyBackspace"),
    tab: t("keyTab"),
    space: t("keySpace"),
    home: t("keyHome"),
    end: t("keyEnd"),
    pageUp: t("keyPageUp"),
    pageDown: t("keyPageDown"),
    insert: t("keyInsert"),
    up: t("keyUp"),
    down: t("keyDown"),
    left: t("keyLeft"),
    right: t("keyRight"),
  };
}

/** The same names in words, for screen readers (CHK028). */
export function spokenKeyNames(isMac = isMacPlatform()): KeyNames {
  return {
    cmd: t("keySpokenCmd"),
    ctrl: t("keySpokenCtrl"),
    shift: t("keySpokenShift"),
    alt: t("keySpokenAlt"),
    option: t("keySpokenOption"),
    enter: isMac ? t("keySpokenReturn") : t("keySpokenEnter"),
    esc: t("keySpokenEsc"),
    delete: t("keySpokenDelete"),
    backspace: t("keySpokenBackspace"),
    tab: t("keySpokenTab"),
    space: t("keySpokenSpace"),
    home: t("keySpokenHome"),
    end: t("keySpokenEnd"),
    pageUp: t("keySpokenPageUp"),
    pageDown: t("keySpokenPageDown"),
    insert: t("keySpokenInsert"),
    up: t("keySpokenUp"),
    down: t("keySpokenDown"),
    left: t("keySpokenLeft"),
    right: t("keySpokenRight"),
  };
}

/** The Enter key's name for hints in prose (011 FR-031, FR-032): Return on macOS. */
export function enterKey(isMac = isMacPlatform()): string {
  return keyNames(isMac).enter;
}

/** Shift with Enter, for hints in prose: "Shift+Return" on macOS. */
export function shiftEnterKey(isMac = isMacPlatform()): string {
  return `${t("keyShift")}+${enterKey(isMac)}`;
}

/**
 * 018 FR-019, FR-032: a cleanup time in words for the Trash and Archive notes, its non-zero parts only: "10 years",
 * "30 days", "1 year 2 days 3 hours".
 */
export function formatCleanupTime(hours: number): string {
  const p = splitHours(hours);
  const parts: string[] = [];
  if (p.years > 0) parts.push(t("yearsN", { count: p.years }));
  if (p.days > 0) parts.push(t("daysN", { count: p.days }));
  if (p.hours > 0) parts.push(t("hoursN", { count: p.hours }));
  return parts.join(" ");
}
