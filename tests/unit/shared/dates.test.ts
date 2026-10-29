import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Lang } from "../../../src/domain/language";
import { ageUnits, formatDate, formatTime, setLanguage, t } from "../../../src/renderer/i18n/t";

// One instant, 2026-03-05 14:07 UTC, read in UTC (research §5, CHK007).
const TS = Date.UTC(2026, 2, 5, 14, 7);

describe("dates, times and units per language (007 FR-018)", () => {
  beforeAll(() => {
    process.env["TZ"] = "UTC";
  });
  afterEach(() => {
    setLanguage("en");
  });

  it.each([
    ["en", "Mar 5, 2026", "2:07 PM", { d: "d", h: "h", m: "m" }],
    ["pt-BR", "5 de mar. de 2026", "14:07", { d: "d", h: "h", m: "min" }],
    ["it", "5 mar 2026", "14:07", { d: "g", h: "h", m: "min" }],
    ["es-ES", "5 mar 2026", "14:07", { d: "d", h: "h", m: "min" }],
    ["fr", "5 mars 2026", "14:07", { d: "j", h: "h", m: "min" }],
  ] as const)("%s: medium date, short time and unit letters", (lang: Lang, date, time, units) => {
    setLanguage(lang);
    expect(formatDate(TS)).toBe(date);
    // ICU versions differ on the space before AM/PM (U+0020 or U+202F).
    expect(formatTime(TS).replace(/\u202f/g, " ")).toBe(time);
    expect(ageUnits()).toEqual(units);
  });

  it("follows each language's plural rules (FR-019)", () => {
    setLanguage("fr");
    expect(t("daysLeft", { count: 0 })).toBe("0 jour restant");
    expect(t("daysLeft", { count: 2 })).toBe("2 jours restants");
    setLanguage("en");
    expect(t("daysLeft", { count: 0 })).toBe("0 days left");
    expect(t("results", { count: 1 })).toBe("1 result");
  });

  it("falls back to English for a key a language lacks, and to the key for an unknown one", () => {
    setLanguage("it");
    expect(t("noSuchKey" as never)).toBe("noSuchKey");
  });
});
