// 013 T039 (FR-012, PRD Q174): the task context menu reads exactly as the menu bar, in every language.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGS } from "../../../src/domain/language";
import { createI18n } from "../../../src/shared/i18n";

const source = readFileSync(join(import.meta.dirname, "../../../src/renderer/features/tasks/TaskCard.tsx"), "utf8");
const KEYS = ["menuNewSubtask", "menuShowDetails", "menuReschedule", "menuAlertPeriod", "menuMoveToTrash"];

describe("013 FR-012 the task context menu's labels", () => {
  it("uses the menu bar's keys, in the context menu's order, and none of the old ones", () => {
    const at = KEYS.map((k) => source.indexOf(`t("${k}")`));
    for (const [i, pos] of at.entries()) expect(pos, KEYS[i]).toBeGreaterThan(0);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const old of ["addSub", "details", "alertOv", "del"]) expect(source).not.toContain(`label: t("${old}")`);
  });

  it("015 FR-001 Reschedule is listed for every active task and subtask, stale or not", () => {
    expect(source).toMatch(/items\.push\(\{\s*key: "resched",\s*label: t\("menuReschedule"\)/);
    expect(source).not.toMatch(/if \(stale\)\s*items\.push\(\{\s*key: "resched"/);
  });

  it("015 FR-010 Postpone For follows Reschedule and opens the four quick durations as a row", () => {
    expect(source).toMatch(/key: "resched"[\s\S]*?key: "postponeFor",\s*label: t\("menuPostponeFor"\)[\s\S]*?submenu: postponeItems\(task\.id, quickDurations\(alertSettings\)\)/);
    expect(source.indexOf('key: "postponeFor"')).toBeLessThan(source.indexOf('key: "ov"'));
  });

  it("New Subtask is offered on top-level tasks only", () => {
    expect(source).toMatch(/if \(!isSub\) \{\s*items\.push\(\{\s*key: "sub",\s*label: t\("menuNewSubtask"\)/);
  });

  it.each(LANGS)("each label is the menu bar's text in %s", (lang) => {
    const { t } = createI18n(lang);
    for (const k of KEYS) expect(t(k).length, k).toBeGreaterThan(0);
    if (lang === "en") expect(KEYS.map((k) => t(k))).toEqual(["New Subtask", "Show Details", "Reschedule", "Alert Period…", "Move to Trash"]);
  });
});
