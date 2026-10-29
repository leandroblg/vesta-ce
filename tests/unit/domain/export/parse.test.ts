// T005: reading data.json (data-model "Validation rules", contracts/export-format.md; FR-012a, FR-021, FR-022).
import { describe, expect, it } from "vitest";
import { toExportJson, type ExportData, type ExportSetting } from "../../../../src/domain/export/format";
import { clampExportTimes, parseExport, type Refusal } from "../../../../src/domain/export/parse";
import type { Reminder } from "../../../../src/domain/reminder";
import type { Task } from "../../../../src/domain/task";
import { mk, mkReminder } from "../fixtures";

const H = (c: string) => c.repeat(64);

/** Built once: the fixture ids come from a counter, so every call must return the same data. */
const VALID = build();

function valid(): ExportData {
  return structuredClone(VALID);
}

function build(): ExportData {
  const parent = mk({ titleMd: "Parent" });
  return {
    appVersion: "0.8.0",
    exportedAt: 1_792_400_000_000,
    tasks: [
      parent,
      mk({ parentId: parent.id, titleMd: "Sub", alertOverrideMin: 90, staleSince: 500, wasStale: true, firstBlinkCount: 3 }),
      mk({ doneAt: 700, prevSiblingId: "gone", leftWithId: "also-gone" }),
    ],
    reminders: [mkReminder(), mkReminder({ deletedAt: 900 })],
    settings: [
      { key: "alertPeriodMin", value: 120, updatedAt: 10 },
      { key: "reblinkIntervalMin", value: 30, updatedAt: 0 },
      { key: "rescheduleToleranceMin", value: 60, updatedAt: 0 },
      { key: "theme", value: "dark", updatedAt: 11 },
      { key: "language", value: "pt-BR", updatedAt: 12 },
      { key: "shortcuts", value: { newTask: ["Mod+Alt+N"], minimize: ["Mod+M"] }, updatedAt: 13 },
      { key: "panelWidth", value: 420, updatedAt: 0 },
      { key: "remindersCollapsed", value: true, updatedAt: 14 },
      { key: "logLevel", value: "debug", updatedAt: 15 },
      { key: "autoUpdateCheck", value: false, updatedAt: 16 },
    ],
    assets: [
      { sha256: H("a"), ext: "png", mimeType: "image/png", size: 10 },
      { sha256: H("b"), ext: "", mimeType: "application/octet-stream", size: 0 },
    ],
  };
}

type Json = Record<string, unknown>;

/** The valid file as a plain object, changed by `edit`, back to text. */
function withEdit(edit: (o: Json) => void): string {
  const o = JSON.parse(toExportJson(valid())) as Json;
  edit(o);
  return JSON.stringify(o);
}

const arr = (o: Json, k: string) => o[k] as Json[];
const at = (o: Json, k: string, i: number) => arr(o, k)[i] as Json;

function refusal(text: string): Refusal {
  const result = parseExport(text);
  if (result.ok) throw new Error("expected a refusal");
  return result.refusal;
}

const damaged = (where: string) => ({ kind: "damaged", cause: "invalidField", where });

describe("parseExport: a valid file", () => {
  it("round-trips the writer's output", () => {
    const data = valid();
    const result = parseExport(toExportJson(data));
    expect(result).toEqual({ ok: true, data: { ...data, taskEvents: data.taskEvents ?? [] }, ignored: [] });
  });
});

describe("parseExport: header", () => {
  it("refuses text that is not JSON or not an object as notVesta", () => {
    expect(refusal("PK\u0003\u0004")).toEqual({ kind: "notVesta" });
    expect(refusal('{"format":"vesta-export","formatVersion":1,"tasks":[')).toEqual({ kind: "notVesta" });
    expect(refusal("[]")).toEqual({ kind: "notVesta" });
    expect(refusal("null")).toEqual({ kind: "notVesta" });
  });

  it("refuses a missing or wrong format marker as notVesta", () => {
    expect(refusal(withEdit((o) => delete o["format"]))).toEqual({ kind: "notVesta" });
    expect(refusal(withEdit((o) => (o["format"] = "other-app")))).toEqual({ kind: "notVesta" });
  });

  it("refuses a newer format version", () => {
    expect(refusal(withEdit((o) => (o["formatVersion"] = 2)))).toEqual({ kind: "newerVersion", version: 2 });
    expect(refusal(withEdit((o) => (o["formatVersion"] = 99)))).toEqual({ kind: "newerVersion", version: 99 });
  });

  it("refuses a format version that is not an integer ≥ 1 as damaged", () => {
    expect(refusal(withEdit((o) => (o["formatVersion"] = "1")))).toEqual(damaged("formatVersion"));
    expect(refusal(withEdit((o) => (o["formatVersion"] = 0)))).toEqual(damaged("formatVersion"));
    expect(refusal(withEdit((o) => (o["formatVersion"] = 1.5)))).toEqual(damaged("formatVersion"));
  });

  it("refuses a bad appVersion, exportedAt or a missing array", () => {
    expect(refusal(withEdit((o) => (o["appVersion"] = 8)))).toEqual(damaged("appVersion"));
    expect(refusal(withEdit((o) => (o["exportedAt"] = -1)))).toEqual(damaged("exportedAt"));
    expect(refusal(withEdit((o) => delete o["tasks"]))).toEqual(damaged("tasks"));
    expect(refusal(withEdit((o) => (o["reminders"] = {})))).toEqual(damaged("reminders"));
    expect(refusal(withEdit((o) => (o["settings"] = null)))).toEqual(damaged("settings"));
    expect(refusal(withEdit((o) => delete o["assets"]))).toEqual(damaged("assets"));
  });
});

describe("parseExport: items", () => {
  it("requires non-empty ids, unique within their array", () => {
    expect(refusal(withEdit((o) => (at(o, "tasks", 1)["id"] = "")))).toEqual(damaged("tasks[1].id"));
    expect(refusal(withEdit((o) => (at(o, "tasks", 2)["id"] = at(o, "tasks", 0)["id"])))).toEqual(damaged("tasks[2].id"));
    expect(refusal(withEdit((o) => (at(o, "reminders", 1)["id"] = at(o, "reminders", 0)["id"])))).toEqual(damaged("reminders[1].id"));
  });

  it("accepts a task and a reminder sharing an id: they never match each other", () => {
    expect(parseExport(withEdit((o) => (at(o, "reminders", 0)["id"] = at(o, "tasks", 0)["id"]))).ok).toBe(true);
  });

  it("requires links to be null or strings, which may name absent items", () => {
    for (const f of ["parentId", "prevSiblingId", "nextSiblingId", "leftWithId"]) {
      expect(refusal(withEdit((o) => (at(o, "tasks", 0)[f] = 5)))).toEqual(damaged(`tasks[0].${f}`));
    }
    expect(refusal(withEdit((o) => (at(o, "reminders", 0)["nextSiblingId"] = false)))).toEqual(damaged("reminders[0].nextSiblingId"));
  });

  it("requires text fields to be strings", () => {
    expect(refusal(withEdit((o) => (at(o, "tasks", 0)["titleMd"] = null)))).toEqual(damaged("tasks[0].titleMd"));
    expect(refusal(withEdit((o) => (at(o, "tasks", 0)["detailsMd"] = 1)))).toEqual(damaged("tasks[0].detailsMd"));
    expect(refusal(withEdit((o) => (at(o, "reminders", 0)["textMd"] = [])))).toEqual(damaged("reminders[0].textMd"));
  });

  it("requires a finite position", () => {
    expect(refusal(withEdit((o) => (at(o, "tasks", 0)["position"] = "1")))).toEqual(damaged("tasks[0].position"));
    expect(refusal(withEdit((o) => (at(o, "reminders", 0)["position"] = null)))).toEqual(damaged("reminders[0].position"));
  });

  it("requires times to be integers ≥ 0, or null only where the column allows it", () => {
    expect(refusal(withEdit((o) => (at(o, "tasks", 0)["createdAt"] = null)))).toEqual(damaged("tasks[0].createdAt"));
    expect(refusal(withEdit((o) => (at(o, "tasks", 0)["updatedAt"] = -5)))).toEqual(damaged("tasks[0].updatedAt"));
    expect(refusal(withEdit((o) => (at(o, "tasks", 0)["staleBaseAt"] = 1.5)))).toEqual(damaged("tasks[0].staleBaseAt"));
    expect(refusal(withEdit((o) => (at(o, "tasks", 0)["staleSince"] = "x")))).toEqual(damaged("tasks[0].staleSince"));
    expect(refusal(withEdit((o) => (at(o, "tasks", 0)["lastBlinkAt"] = -1)))).toEqual(damaged("tasks[0].lastBlinkAt"));
    expect(refusal(withEdit((o) => (at(o, "tasks", 0)["lastSignalAt"] = true)))).toEqual(damaged("tasks[0].lastSignalAt"));
    expect(refusal(withEdit((o) => (at(o, "reminders", 0)["doneAt"] = 2.5)))).toEqual(damaged("reminders[0].doneAt"));
  });

  it("refuses doneAt and deletedAt both set", () => {
    expect(refusal(withEdit((o) => (at(o, "tasks", 2)["deletedAt"] = 800)))).toEqual(damaged("tasks[2].deletedAt"));
    expect(refusal(withEdit((o) => (at(o, "reminders", 1)["doneAt"] = 800)))).toEqual(damaged("reminders[1].deletedAt"));
  });

  it("requires alertOverrideMin null or an integer ≥ 60", () => {
    expect(refusal(withEdit((o) => (at(o, "tasks", 1)["alertOverrideMin"] = 59)))).toEqual(damaged("tasks[1].alertOverrideMin"));
    expect(refusal(withEdit((o) => (at(o, "tasks", 1)["alertOverrideMin"] = 60.5)))).toEqual(damaged("tasks[1].alertOverrideMin"));
  });

  it("requires firstBlinkCount null, 1 or 3", () => {
    expect(refusal(withEdit((o) => (at(o, "tasks", 1)["firstBlinkCount"] = 2)))).toEqual(damaged("tasks[1].firstBlinkCount"));
  });

  it("requires booleans", () => {
    for (const f of ["collapsed", "wasStale", "manuallyPositioned"]) {
      expect(refusal(withEdit((o) => (at(o, "tasks", 0)[f] = 0)))).toEqual(damaged(`tasks[0].${f}`));
    }
  });

  it("refuses a missing field, except rescheduleForMin, which an export from before 015 lacks", () => {
    expect(refusal(withEdit((o) => delete at(o, "tasks", 0)["lastSignalAt"]))).toEqual(damaged("tasks[0].lastSignalAt"));
    expect(refusal(withEdit((o) => delete at(o, "reminders", 0)["prevSiblingId"]))).toEqual(damaged("reminders[0].prevSiblingId"));
  });

  it("015 C1: reads a task without rescheduleForMin as null, and checks it when present (60–43,200 or null)", () => {
    const older = parseExport(withEdit((o) => delete at(o, "tasks", 0)["rescheduleForMin"]));
    expect(older.ok && older.data.tasks[0]?.rescheduleForMin).toBeNull();
    const quick = parseExport(withEdit((o) => (at(o, "tasks", 0)["rescheduleForMin"] = 120)));
    expect(quick.ok && quick.data.tasks[0]?.rescheduleForMin).toBe(120);
    for (const bad of [59, 43_201, 1.5, "60"]) {
      expect(refusal(withEdit((o) => (at(o, "tasks", 0)["rescheduleForMin"] = bad)))).toEqual(damaged("tasks[0].rescheduleForMin"));
    }
  });

  it("018: reads a task or reminder without keptDoneAt as null, keeps it when present and refuses a bad value", () => {
    const older = parseExport(
      withEdit((o) => {
        delete at(o, "tasks", 0)["keptDoneAt"];
        delete at(o, "reminders", 1)["keptDoneAt"];
      }),
    );
    expect(older.ok && older.data.tasks[0]?.keptDoneAt).toBeNull();
    expect(older.ok && older.data.reminders[1]?.keptDoneAt).toBeNull();
    const kept = parseExport(withEdit((o) => (at(o, "reminders", 1)["keptDoneAt"] = 1_700_000_000_000)));
    expect(kept.ok && kept.data.reminders[1]?.keptDoneAt).toBe(1_700_000_000_000);
    for (const bad of [1.5, -1, "1700000000000", true]) {
      expect(refusal(withEdit((o) => (at(o, "tasks", 0)["keptDoneAt"] = bad)))).toEqual(damaged("tasks[0].keptDoneAt"));
      expect(refusal(withEdit((o) => (at(o, "reminders", 0)["keptDoneAt"] = bad)))).toEqual(damaged("reminders[0].keptDoneAt"));
    }
  });

  it("refuses an item that is not an object", () => {
    expect(refusal(withEdit((o) => (arr(o, "tasks")[1] = null as unknown as Json)))).toEqual(damaged("tasks[1]"));
  });

  it("drops unknown item fields and reports them (FR-012a)", () => {
    const result = parseExport(
      withEdit((o) => {
        at(o, "tasks", 0)["color"] = "red";
        at(o, "reminders", 1)["pinned"] = true;
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ ...valid(), taskEvents: [] });
    expect(result.ignored).toEqual(["tasks[0].color", "reminders[1].pinned"]);
  });
});

describe("parseExport: settings", () => {
  const setting = (o: Json, key: string) => arr(o, "settings").find((s) => s["key"] === key) as Json;
  const where = (key: string) => `settings[${String(valid().settings.findIndex((s) => s.key === key))}].value`;

  it("validates each known value as at load", () => {
    const bad: [string, unknown][] = [
      ["alertPeriodMin", 59],
      ["alertPeriodMin", "120"],
      ["reblinkIntervalMin", 29],
      ["reblinkIntervalMin", 720 * 60 + 1],
      ["rescheduleToleranceMin", 59.5],
      ["theme", "blue"],
      ["language", "de"],
      ["shortcuts", []],
      ["shortcuts", { newTask: [] }],
      ["shortcuts", { newTask: ["Mod+N", "Mod+N"] }],
      ["shortcuts", { newTask: ["A", "B", "C"] }],
      ["shortcuts", { newTask: ["not a combo"] }],
      ["panelWidth", 299],
      ["panelWidth", 761],
      ["panelWidth", "420"],
      ["remindersCollapsed", "true"],
      ["logLevel", "warning"],
      ["logLevel", "Info"],
      ["logLevel", 3],
      ["autoUpdateCheck", "true"],
      ["autoUpdateCheck", 1],
    ];
    for (const [key, value] of bad) {
      expect(refusal(withEdit((o) => (setting(o, key)["value"] = value)))).toEqual(damaged(where(key)));
    }
  });

  it("accepts every valid value, including system language and theme, and an unknown shortcut action", () => {
    const ok: [string, unknown][] = [
      ["theme", "system"],
      ["language", "system"],
      ["language", "fr"],
      ["shortcuts", {}],
      ["shortcuts", { someFutureAction: ["Mod+K"] }],
      ["panelWidth", 300],
      ["panelWidth", 760],
      ["remindersCollapsed", false],
      ["logLevel", "fatal"],
      ["logLevel", "trace"],
      ["autoUpdateCheck", true],
    ];
    for (const [key, value] of ok) expect(parseExport(withEdit((o) => (setting(o, key)["value"] = value))).ok).toBe(true);
  });

  it("requires updatedAt an integer ≥ 0 and refuses a duplicate key", () => {
    expect(refusal(withEdit((o) => (setting(o, "theme")["updatedAt"] = -1)))).toEqual(damaged("settings[3].updatedAt"));
    expect(
      refusal(withEdit((o) => arr(o, "settings").push({ key: "theme", value: "light", updatedAt: 1 }))),
    ).toEqual(damaged("settings[10].key"));
  });

  it("ignores and reports an unknown setting key, including the local update notice (FR-012a; 009 FR-024a)", () => {
    const result = parseExport(
      withEdit((o) => arr(o, "settings").push({ key: "updateNotice", value: { version: "0.2.0", seen: false }, updatedAt: 3 })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.settings).toEqual(valid().settings);
    expect(result.ignored).toEqual(["settings[10] (updateNotice)"]);
  });
});

describe("parseExport: file list", () => {
  it("requires 64 lowercase hex, unique", () => {
    expect(refusal(withEdit((o) => (at(o, "assets", 0)["sha256"] = "a".repeat(63))))).toEqual(damaged("assets[0].sha256"));
    expect(refusal(withEdit((o) => (at(o, "assets", 0)["sha256"] = "A".repeat(64))))).toEqual(damaged("assets[0].sha256"));
    expect(refusal(withEdit((o) => (at(o, "assets", 1)["sha256"] = H("a"))))).toEqual(damaged("assets[1].sha256"));
  });

  it('requires ext "" or 1–16 of [a-z0-9]', () => {
    expect(refusal(withEdit((o) => (at(o, "assets", 0)["ext"] = "PNG")))).toEqual(damaged("assets[0].ext"));
    expect(refusal(withEdit((o) => (at(o, "assets", 0)["ext"] = "a".repeat(17))))).toEqual(damaged("assets[0].ext"));
    expect(refusal(withEdit((o) => (at(o, "assets", 0)["ext"] = "p.g")))).toEqual(damaged("assets[0].ext"));
    expect(parseExport(withEdit((o) => (at(o, "assets", 0)["ext"] = "a".repeat(16)))).ok).toBe(true);
  });

  it("requires size an integer 0–104,857,600; a larger file is named as too large", () => {
    expect(refusal(withEdit((o) => (at(o, "assets", 0)["size"] = 104_857_601)))).toEqual({
      kind: "damaged",
      cause: "tooLarge",
      where: `assets/${H("a")}.png`,
    });
    expect(refusal(withEdit((o) => (at(o, "assets", 0)["size"] = -1)))).toEqual(damaged("assets[0].size"));
    expect(parseExport(withEdit((o) => (at(o, "assets", 0)["size"] = 104_857_600))).ok).toBe(true);
  });

  it("requires mimeType a non-empty string of at most 255 characters", () => {
    expect(refusal(withEdit((o) => (at(o, "assets", 0)["mimeType"] = "")))).toEqual(damaged("assets[0].mimeType"));
    expect(refusal(withEdit((o) => (at(o, "assets", 0)["mimeType"] = "x".repeat(256))))).toEqual(damaged("assets[0].mimeType"));
  });

  it("puts only a field path in where, never prose", () => {
    const r = refusal(withEdit((o) => (at(o, "assets", 0)["size"] = "big")));
    expect(r.kind === "damaged" && /^[a-zA-Z]+(\[\d+\])?(\.[a-zA-Z0-9]+)?$/.test(r.where)).toBe(true);
  });
});

describe("010 L1/L10/L14: import limits shared with IPC, listing limits and the time clamp", () => {
  const settingsArr = (o: Json) => o["settings"] as Json[];

  it("L1 texts over the shared limits are damaged; at the limit they are accepted", () => {
    expect(refusal(withEdit((o) => (at(o, "tasks", 0)["titleMd"] = "a".repeat(10_001))))).toEqual(damaged("tasks[0].titleMd"));
    expect(parseExport(withEdit((o) => (at(o, "tasks", 0)["titleMd"] = "a".repeat(10_000)))).ok).toBe(true);
    expect(refusal(withEdit((o) => (at(o, "tasks", 0)["detailsMd"] = "a".repeat(1_000_001))))).toEqual(damaged("tasks[0].detailsMd"));
    expect(refusal(withEdit((o) => (at(o, "reminders", 0)["textMd"] = "a".repeat(10_001))))).toEqual(damaged("reminders[0].textMd"));
    expect(parseExport(withEdit((o) => (at(o, "reminders", 0)["textMd"] = "a".repeat(10_000)))).ok).toBe(true);
  });

  it("L1/L14 ids must have Vesta's UUID shape; link fields are bounded", () => {
    expect(refusal(withEdit((o) => (at(o, "tasks", 0)["id"] = "not-a-uuid")))).toEqual(damaged("tasks[0].id"));
    expect(refusal(withEdit((o) => (at(o, "reminders", 0)["id"] = "x".repeat(40))))).toEqual(damaged("reminders[0].id"));
    expect(refusal(withEdit((o) => (at(o, "tasks", 0)["parentId"] = "x".repeat(65))))).toEqual(damaged("tasks[0].parentId"));
    expect(parseExport(withEdit((o) => (at(o, "tasks", 0)["prevSiblingId"] = "x".repeat(64)))).ok).toBe(true);
  });

  it("L1 the alert override shares the IPC range", () => {
    expect(refusal(withEdit((o) => (at(o, "tasks", 1)["alertOverrideMin"] = 14_400_000)))).toEqual(damaged("tasks[1].alertOverrideMin"));
    expect(parseExport(withEdit((o) => (at(o, "tasks", 1)["alertOverrideMin"] = 14_399_999))).ok).toBe(true);
  });

  it("Q133 the reminder settings travel: a switch and whole days from 7 to 365", () => {
    const withSetting = (key: string, value: unknown) => withEdit((o) => settingsArr(o).push({ key, value, updatedAt: 20 }));
    expect(parseExport(withSetting("updateReminder", false)).ok).toBe(true);
    expect(refusal(withSetting("updateReminder", "no"))).toEqual(damaged("settings[10].value"));
    for (const days of [7, 30, 365]) expect(parseExport(withSetting("updateReminderDays", days)).ok, String(days)).toBe(true);
    for (const days of [6, 366, 30.5]) expect(refusal(withSetting("updateReminderDays", days))).toEqual(damaged("settings[10].value"));
    const parsed = parseExport(withSetting("updateReminderDays", 90));
    expect(parsed.ok && parsed.data.settings.at(-1)).toEqual({ key: "updateReminderDays", value: 90, updatedAt: 20 });
  });

  it("018 FR-016a the cleanup settings travel: a switch and a whole number of hours from 1 to 8,768,759", () => {
    const withSetting = (key: string, value: unknown) => withEdit((o) => settingsArr(o).push({ key, value, updatedAt: 20 }));
    expect(parseExport(withSetting("archiveCleanupOn", false)).ok).toBe(true);
    expect(refusal(withSetting("trashCleanupOn", "no"))).toEqual(damaged("settings[10].value"));
    for (const h of [1, 720, 8_768_759]) expect(parseExport(withSetting("trashCleanupHours", h)).ok, String(h)).toBe(true);
    for (const h of [0, 8_768_760, 1.5, "720"]) expect(refusal(withSetting("trashCleanupHours", h)), String(h)).toEqual(damaged("settings[10].value"));
  });

  it("FR-017 the 011 editor settings travel with their limits", () => {
    const withSetting = (key: string, value: unknown) => withEdit((o) => settingsArr(o).push({ key, value, updatedAt: 20 }));
    expect(parseExport(withSetting("pinnedColors", [{ hex: "#ffe066ff", at: 3 }])).ok).toBe(true);
    expect(parseExport(withSetting("recentColors", ["#ffe066ff"])).ok).toBe(true);
    expect(parseExport(withSetting("tableRowsFirst", true)).ok).toBe(true);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ hex: `#0000${i.toString(16).padStart(2, "0")}ff`, at: 1 }));
    expect(refusal(withSetting("pinnedColors", eleven))).toEqual(damaged("settings[10].value"));
    expect(refusal(withSetting("pinnedColors", [{ hex: "#ffe066ff" }]))).toEqual(damaged("settings[10].value"));
    expect(refusal(withSetting("recentColors", ["#ffe066"]))).toEqual(damaged("settings[10].value"));
    expect(refusal(withSetting("tableRowsFirst", "yes"))).toEqual(damaged("settings[10].value"));
  });

  it("FR-017 a pinned time later than the import moment is clamped to it", () => {
    const parsed = parseExport(withEdit((o) => settingsArr(o).push({ key: "pinnedColors", value: [{ hex: "#ffe066ff", at: 9e15 }], updatedAt: 20 })));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const clamped = clampExportTimes(parsed.data, 1_000);
    expect(clamped.data.settings.at(-1)?.value).toEqual([{ hex: "#ffe066ff", at: 1_000 }]);
    expect(clamped.count).toBeGreaterThanOrEqual(1);
  });

  it("L10 more than 10,000 listed files is damaged; exactly 10,000 is accepted", () => {
    const many = (n: number) => withEdit((o) => (o["assets"] = Array.from({ length: n }, (_, i) => ({ sha256: i.toString(16).padStart(64, "0"), ext: "", mimeType: "application/octet-stream", size: 0 }))));
    expect(parseExport(many(10_000)).ok).toBe(true);
    expect(refusal(many(10_001))).toEqual({ kind: "damaged", cause: "tooManyFiles", where: "assets" });
  });

  it("L10 listed files totalling more than 4 GiB are damaged; exactly 4 GiB is accepted", () => {
    const total = (extra: number) =>
      withEdit((o) => {
        const files = Array.from({ length: 40 }, (_, i) => ({ sha256: i.toString(16).padStart(64, "0"), ext: "bin", mimeType: "application/octet-stream", size: 104_857_600 }));
        files.push({ sha256: "f".repeat(64), ext: "bin", mimeType: "application/octet-stream", size: 100_663_296 + extra });
        o["assets"] = files;
      });
    expect(parseExport(total(0)).ok).toBe(true); // 40 × 100 MB + 100,663,296 = 4,294,967,296
    expect(refusal(total(1))).toEqual({ kind: "damaged", cause: "tooLargeTotal", where: "assets" });
  });

  it("L14 clampExportTimes sets every later time to the import moment and counts them", () => {
    const now = 1_000;
    const data = valid();
    const t = data.tasks[0] as Task;
    Object.assign(t, { createdAt: now + 1, updatedAt: now + 50, doneAt: null, deletedAt: null, staleBaseAt: now + 2, staleSince: now + 3, lastBlinkAt: now + 4, lastSignalAt: now + 5 });
    const r = data.reminders[0] as Reminder;
    Object.assign(r, { createdAt: now - 1, updatedAt: now + 9, doneAt: now + 10, deletedAt: null });
    (data.settings[0] as ExportSetting).updatedAt = now + 7;
    const { data: clamped, count } = clampExportTimes(data, now);
    expect(count).toBe(9);
    expect(clamped.tasks[0]).toMatchObject({ createdAt: now, updatedAt: now, staleBaseAt: now, staleSince: now, lastBlinkAt: now, lastSignalAt: now });
    expect(clamped.reminders[0]).toMatchObject({ createdAt: now - 1, updatedAt: now, doneAt: now });
    expect(clamped.settings[0]?.updatedAt).toBe(now);
    expect(clamped.settings[1]?.updatedAt).toBe(0);
    expect(data.tasks[0]?.createdAt).toBe(now + 1); // the input is untouched
    expect(clampExportTimes(valid(), 10_000_000_000_000).count).toBe(0);
  });
});

describe("015 taskEvents in data.json (research §6; T031)", () => {
  const event = { id: "00000000-0000-4000-8000-00000000e001", taskId: "00000000-0000-4000-8000-000000000001", kind: "rescheduled", at: 5, detail: 120 };
  const withEvents = (events: unknown) => withEdit((o) => (o["taskEvents"] = events as never));

  it("reads the events; an older file without them reads as none", () => {
    const r = parseExport(withEvents([event]));
    expect(r.ok && r.data.taskEvents).toEqual([event]);
    const older = parseExport(withEdit((o) => delete o["taskEvents"]));
    expect(older.ok && older.data.taskEvents).toEqual([]);
  });

  it("refuses an event with a bad kind, time, detail or id", () => {
    for (const bad of [{ ...event, kind: "edited" }, { ...event, at: -1 }, { ...event, detail: 1.5 }, { ...event, id: "" }, { ...event, taskId: 3 }, "x"]) {
      expect(parseExport(withEvents([bad])).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(parseExport(withEvents({})).ok).toBe(false);
  });

  it("takes the four quick durations as settings, within 60–43,200", () => {
    const ok = parseExport(withEdit((o) => (o["settings"] = [{ key: "quickReschedule1Min", value: 90, updatedAt: 1 }] as never)));
    expect(ok.ok && ok.data.settings).toEqual([{ key: "quickReschedule1Min", value: 90, updatedAt: 1 }]);
  });
});
