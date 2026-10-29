// T013: the merge, by example (data-model "Merge state per incoming item"; FR-031 to FR-041, FR-035).
import { describe, expect, it } from "vitest";
import type { ExportData, ExportSetting } from "../../../../src/domain/export/format";
import { mergeImport, type LocalData } from "../../../../src/domain/export/merge";
import type { Task } from "../../../../src/domain/task";
import { id, mk, mkReminder } from "../fixtures";

const NOW = 1_000_000;
const ctx = { now: NOW, isMac: false };

function local(over: Partial<LocalData> = {}): LocalData {
  return { tasks: [], reminders: [], settings: [], assetHashes: new Set(), ...over };
}

function incoming(over: Partial<ExportData> = {}): ExportData {
  return { appVersion: "0.8.0", exportedAt: 5, tasks: [], reminders: [], settings: [], assets: [], ...over };
}

const byId = (rows: readonly Task[], k: string) => rows.find((t) => t.id === k);

describe("mergeImport: matching items", () => {
  it("adds an item only in the export", () => {
    const t = mk({ id: id(1) });
    const r = mkReminder({ id: id(2) });
    const plan = mergeImport(local(), incoming({ tasks: [t], reminders: [r] }), ctx);
    expect(plan.taskUpserts).toEqual([t]);
    expect(plan.reminderUpserts).toEqual([r]);
    expect(plan.counts).toEqual({ added: 2, updated: 0, unchanged: 0 });
  });

  it("replaces field for field when the import is strictly newer, empty fields included", () => {
    const mine = mk({ id: id(1), titleMd: "old", updatedAt: 10, alertOverrideMin: 120, staleSince: 50, wasStale: true });
    const theirs = { ...mine, titleMd: "new", updatedAt: 11, alertOverrideMin: null, staleSince: null, collapsed: true };
    const plan = mergeImport(local({ tasks: [mine] }), incoming({ tasks: [theirs] }), ctx);
    expect(plan.taskUpserts).toEqual([theirs]);
    expect(plan.counts).toEqual({ added: 0, updated: 1, unchanged: 0 });
  });

  it("keeps the local version when it is as new or newer", () => {
    const mine = mk({ id: id(1), titleMd: "mine", updatedAt: 10 });
    const same = { ...mine, titleMd: "different but same time" };
    const older = { ...mine, titleMd: "older", updatedAt: 9 };
    for (const theirs of [same, older]) {
      const plan = mergeImport(local({ tasks: [mine] }), incoming({ tasks: [theirs] }), ctx);
      expect(plan.taskUpserts).toEqual([]);
      expect(plan.counts).toEqual({ added: 0, updated: 0, unchanged: 1 });
    }
  });

  it("never matches a task with a reminder that shares its id", () => {
    const t = mk({ id: id(1) });
    const r = mkReminder({ id: id(1) });
    const plan = mergeImport(local({ tasks: [t] }), incoming({ reminders: [r] }), ctx);
    expect(plan.reminderUpserts).toEqual([r]);
    expect(plan.counts.added).toBe(1);
  });

  it("leaves local-only items alone", () => {
    const mine = mk({ id: id(1) });
    const plan = mergeImport(local({ tasks: [mine], reminders: [mkReminder()] }), incoming(), ctx);
    expect(plan.taskUpserts).toEqual([]);
    expect(plan.reminderUpserts).toEqual([]);
  });

  it("carries the collapse state only with a newer version (collapse is not an edit, FR-032)", () => {
    const mine = mk({ id: id(1), collapsed: true, updatedAt: 20 });
    const theirs = { ...mine, collapsed: false, updatedAt: 20 };
    expect(mergeImport(local({ tasks: [mine] }), incoming({ tasks: [theirs] }), ctx).taskUpserts).toEqual([]);
  });

  it("adds every incoming active reminder even above 200 (FR-038)", () => {
    const mine = Array.from({ length: 195 }, () => mkReminder());
    const theirs = Array.from({ length: 10 }, () => mkReminder());
    const plan = mergeImport(local({ reminders: mine }), incoming({ reminders: theirs }), ctx);
    expect(plan.reminderUpserts).toHaveLength(10);
    expect(plan.counts.added).toBe(10);
  });

  it("counts every incoming task and reminder exactly once", () => {
    const a = mk({ id: id(1), updatedAt: 5 });
    const b = mk({ id: id(2), updatedAt: 5 });
    const plan = mergeImport(
      local({ tasks: [a, b] }),
      incoming({ tasks: [{ ...a, updatedAt: 6 }, b, mk({ id: id(3) })], reminders: [mkReminder()] }),
      ctx,
    );
    expect(plan.counts).toEqual({ added: 2, updated: 1, unchanged: 1 });
  });
});

describe("mergeImport: settings (FR-033)", () => {
  const s = (key: ExportSetting["key"], value: unknown, updatedAt: number): ExportSetting => ({ key, value, updatedAt });

  it("takes each setting that is strictly newer, keeps the rest", () => {
    const plan = mergeImport(
      local({ settings: [s("theme", "light", 10), s("language", "fr", 10), s("panelWidth", 420, 0)] }),
      incoming({ settings: [s("theme", "dark", 11), s("language", "it", 10), s("panelWidth", 500, 0)] }),
      ctx,
    );
    expect(plan.settingUpserts).toEqual([s("theme", "dark", 11)]);
  });

  it("merges the 009 log level and automatic update check by newest change time", () => {
    const plan = mergeImport(
      local({ settings: [s("logLevel", "info", 5), s("autoUpdateCheck", true, 9)] }),
      incoming({ settings: [s("logLevel", "trace", 6), s("autoUpdateCheck", false, 8)] }),
      ctx,
    );
    expect(plan.settingUpserts).toEqual([s("logLevel", "trace", 6)]);
  });

  it("FR-017 recentColors and tableRowsFirst keep local on a tie and take the import only when strictly newer", () => {
    const tie = mergeImport(
      local({ settings: [s("recentColors", ["#000001ff"], 5), s("tableRowsFirst", false, 5)] }),
      incoming({ settings: [s("recentColors", ["#000002ff"], 5), s("tableRowsFirst", true, 6)] }),
      ctx,
    );
    expect(tie.settingUpserts).toEqual([s("tableRowsFirst", true, 6)]);
  });

  it("016 FR-022 lastTextColor takes the import only when strictly newer", () => {
    const plan = mergeImport(
      local({ settings: [s("lastTextColor", "#b9411cff", 5)] }),
      incoming({ settings: [s("lastTextColor", "#2563ebff", 6)] }),
      ctx,
    );
    expect(plan.settingUpserts).toEqual([s("lastTextColor", "#2563ebff", 6)]);
    const older = mergeImport(local({ settings: [s("lastTextColor", "#b9411cff", 7)] }), incoming({ settings: [s("lastTextColor", "#2563ebff", 6)] }), ctx);
    expect(older.settingUpserts).toEqual([]);
  });

  it("FR-017 pinned colors merge color by color", () => {
    const plan = mergeImport(
      local({ settings: [s("pinnedColors", [{ hex: "#00000aff", at: 1 }, { hex: "#00000bff", at: 5 }], 7)] }),
      incoming({ settings: [s("pinnedColors", [{ hex: "#00000bff", at: 3 }, { hex: "#00000cff", at: 4 }], 6)] }),
      ctx,
    );
    expect(plan.settingUpserts).toEqual([
      s(
        "pinnedColors",
        [
          { hex: "#00000bff", at: 5 },
          { hex: "#00000cff", at: 4 },
          { hex: "#00000aff", at: 1 },
        ],
        7,
      ),
    ]);
  });

  it("FR-017 twelve distinct pinned colors keep the newest 10, and recent drops pinned and preset colors", () => {
    const hex = (n: number) => `#0000${n.toString(16).padStart(2, "0")}ff`;
    const mine = Array.from({ length: 6 }, (_, i) => ({ hex: hex(i), at: i }));
    const theirs = Array.from({ length: 6 }, (_, i) => ({ hex: hex(i + 6), at: i + 6 }));
    const plan = mergeImport(
      local({ settings: [s("pinnedColors", mine, 2), s("recentColors", ["#000099ff"], 2)] }),
      incoming({ settings: [s("pinnedColors", theirs, 3), s("recentColors", [hex(11), "#ef4444ff", "#000098ff"], 4)] }),
      ctx,
    );
    const pinned = plan.settingUpserts.find((x) => x.key === "pinnedColors")?.value as { hex: string }[];
    expect(pinned).toHaveLength(10);
    expect(pinned[0]?.hex).toBe(hex(11));
    expect(plan.settingUpserts.find((x) => x.key === "recentColors")).toEqual(s("recentColors", ["#000098ff"], 4));
  });

  it("FR-017 an imported pin that already matches local changes nothing", () => {
    const same = [{ hex: "#00000aff", at: 1 }];
    const plan = mergeImport(local({ settings: [s("pinnedColors", same, 3)] }), incoming({ settings: [s("pinnedColors", same, 2)] }), ctx);
    expect(plan.settingUpserts).toEqual([]);
  });

  it("takes an imported setting that is missing locally", () => {
    const plan = mergeImport(local(), incoming({ settings: [s("remindersCollapsed", true, 3)] }), ctx);
    expect(plan.settingUpserts).toEqual([s("remindersCollapsed", true, 3)]);
  });

  it("takes the shortcut set as a whole, then drops what this OS refuses", () => {
    const plan = mergeImport(
      local({ settings: [s("shortcuts", { search: ["Mod+K"] }, 1)] }),
      incoming({ settings: [s("shortcuts", { newTask: ["Mod+M"], newSub: ["Mod+Alt+S"] }, 2)] }),
      { now: NOW, isMac: true },
    );
    expect(plan.settingUpserts).toEqual([s("shortcuts", { newSub: ["Mod+Alt+S"] }, 2)]);
    expect(plan.droppedShortcuts).toEqual(["newTask"]);
  });
});

describe("mergeImport: repairs, in FR-035 order", () => {
  it("makes tasks in a parent loop top level", () => {
    const a = mk({ id: id(1), parentId: id(2), updatedAt: 5 });
    const b = mk({ id: id(2), parentId: id(1), updatedAt: 5 });
    const plan = mergeImport(local(), incoming({ tasks: [a, b] }), ctx);
    expect(byId(plan.taskUpserts, id(1))?.parentId).toBeNull();
    expect(byId(plan.taskUpserts, id(2))?.parentId).toBeNull();
    expect(plan.repairs).toEqual([
      { id: id(1), rule: "loop" },
      { id: id(2), rule: "loop" },
    ]);
  });

  it("makes a subtask whose parent exists nowhere top level", () => {
    const a = mk({ id: id(1), parentId: id(99) });
    const plan = mergeImport(local(), incoming({ tasks: [a] }), ctx);
    expect(byId(plan.taskUpserts, id(1))?.parentId).toBeNull();
    expect(plan.repairs).toEqual([{ id: id(1), rule: "missingParent" }]);
  });

  it("moves A (under B, under C) to C, right after B", () => {
    const c = mk({ id: id(3), position: 1 });
    const b = mk({ id: id(2), parentId: id(3), position: 1, updatedAt: 5 });
    const later = mk({ id: id(4), parentId: id(3), position: 2 });
    const a = mk({ id: id(1), parentId: id(2), position: 1 });
    const plan = mergeImport(local({ tasks: [c, b, later] }), incoming({ tasks: [a] }), ctx);
    const moved = byId(plan.taskUpserts, id(1));
    expect(moved?.parentId).toBe(id(3));
    expect(moved?.position).toBeGreaterThan(b.position);
    expect(moved?.position).toBeLessThan(later.position);
    expect(plan.repairs).toEqual([{ id: id(1), rule: "twoLevels" }]);
  });

  it("makes an active subtask of a done parent an active top-level task", () => {
    const p = mk({ id: id(2), doneAt: 50, updatedAt: 50 });
    const a = mk({ id: id(1), parentId: id(2) });
    const plan = mergeImport(local({ tasks: [a] }), incoming({ tasks: [p] }), ctx);
    const moved = byId(plan.taskUpserts, id(1));
    expect(moved?.parentId).toBeNull();
    expect(moved?.doneAt).toBeNull();
    expect(plan.repairs).toEqual([{ id: id(1), rule: "activeUnderInactive" }]);
  });

  it("leaves a done subtask under an active parent alone", () => {
    const p = mk({ id: id(2) });
    const a = mk({ id: id(1), parentId: id(2), doneAt: 30 });
    expect(mergeImport(local({ tasks: [p] }), incoming({ tasks: [a] }), ctx).repairs).toEqual([]);
  });

  it("gives one result to a case several rules could match: missing parent first", () => {
    const a = mk({ id: id(1), parentId: id(99) });
    expect(mergeImport(local(), incoming({ tasks: [a] }), ctx).repairs.map((r) => r.rule)).toEqual(["missingParent"]);
  });

  it("stamps repaired rows with the import time and puts active ones after the last active top-level task", () => {
    const top1 = mk({ id: id(10), position: 4 });
    const top2 = mk({ id: id(11), position: 9 });
    const archived = mk({ id: id(12), position: 50, doneAt: 1 });
    const x = mk({ id: id(1), parentId: id(98), position: 3 });
    const y = mk({ id: id(2), parentId: id(99), position: 1 });
    const z = mk({ id: id(3), parentId: id(97), position: 7, deletedAt: 5 });
    const plan = mergeImport(local({ tasks: [top1, top2, archived] }), incoming({ tasks: [x, y, z] }), ctx);
    const after = (k: string) => byId(plan.taskUpserts, k);
    expect(after(id(1))?.updatedAt).toBe(NOW);
    expect(after(id(2))?.position).toBe(10);
    expect(after(id(1))?.position).toBe(11);
    expect(after(id(3))?.position).toBe(7); // a Trash row keeps its position
  });

  it("includes a repaired local-only row in the upserts, not in the counts", () => {
    const c = mk({ id: id(3), updatedAt: 5 });
    const b = mk({ id: id(2), parentId: null, updatedAt: 5 });
    const a = mk({ id: id(1), parentId: id(2) }); // local only
    const theirsB = { ...b, parentId: id(3), updatedAt: 6 }; // B becomes a subtask of C
    const plan = mergeImport(local({ tasks: [a, b, c] }), incoming({ tasks: [theirsB] }), ctx);
    expect(byId(plan.taskUpserts, id(1))?.parentId).toBe(id(3));
    expect(plan.counts).toEqual({ added: 0, updated: 1, unchanged: 0 });
  });
});

describe("mergeImport: files", () => {
  it("adds only the files not stored locally", () => {
    const a = { sha256: "a".repeat(64), ext: "png", mimeType: "image/png", size: 1 };
    const b = { sha256: "b".repeat(64), ext: "pdf", mimeType: "application/pdf", size: 2 };
    const plan = mergeImport(local({ assetHashes: new Set(["a".repeat(64)]) }), incoming({ assets: [a, b] }), ctx);
    expect(plan.assetsToAdd).toEqual([b]);
  });
});

describe("L14 an import never turns the automatic update check on (010 FR-013, PRD Q130)", () => {
  const setting = (value: boolean, updatedAt: number): ExportSetting => ({ key: "autoUpdateCheck", value, updatedAt });
  const upsertOf = (mine: ExportSetting[], theirs: ExportSetting[]) =>
    mergeImport(local({ settings: mine }), incoming({ settings: theirs }), ctx).settingUpserts.find((s) => s.key === "autoUpdateCheck");

  it("L14 local off, import on and newer: stays off", () => {
    expect(upsertOf([setting(false, 10)], [setting(true, 20)])).toBeUndefined();
  });

  it("L14 local on, import off and newer: turns off", () => {
    expect(upsertOf([setting(true, 10)], [setting(false, 20)])).toEqual(setting(false, 20));
  });

  it("L14 both on: unchanged", () => {
    expect(upsertOf([setting(true, 10)], [setting(true, 20)])).toBeUndefined();
  });

  it("L14 local on and newer, import off and older: stays on", () => {
    expect(upsertOf([setting(true, 20)], [setting(false, 10)])).toBeUndefined();
  });

  it("L14 both off: no change; and a missing local row never lets an import turn it on", () => {
    expect(upsertOf([setting(false, 10)], [setting(false, 20)])).toEqual(setting(false, 20));
    expect(upsertOf([], [setting(true, 20)])).toBeUndefined();
    expect(upsertOf([], [setting(false, 20)])).toEqual(setting(false, 20));
  });

  it("L14 every other setting still follows the newest edit", () => {
    const theme = (value: string, updatedAt: number): ExportSetting => ({ key: "theme", value, updatedAt });
    expect(mergeImport(local({ settings: [theme("light", 10)] }), incoming({ settings: [theme("dark", 20)] }), ctx).settingUpserts).toEqual([theme("dark", 20)]);
    expect(mergeImport(local({ settings: [theme("light", 20)] }), incoming({ settings: [theme("dark", 10)] }), ctx).settingUpserts).toEqual([]);
  });
});

describe("FR-015 colors in imported items (contracts/import-rules.md)", () => {
  it("FR-015 imported tasks and reminders are written 8-digit, with their imported updatedAt unchanged", async () => {
    const { rewritePlanColors } = await import("../../../../src/domain/export/merge");
    const t = mk({ titleMd: '[a]{color="#d33"}', detailsMd: '[b]{bg="#ffe066"}', updatedAt: 77 });
    const r = mkReminder({ textMd: '[c]{color="#abc"}', updatedAt: 88 });
    const plan = mergeImport(local(), incoming({ tasks: [t], reminders: [r] }), ctx);
    const out = rewritePlanColors(plan);
    expect(out.taskUpserts[0]).toMatchObject({ titleMd: '[a]{color="#dd3333ff"}', detailsMd: '[b]{bg="#ffe066ff"}', updatedAt: 77 });
    expect(out.reminderUpserts[0]).toMatchObject({ textMd: '[c]{color="#aabbccff"}', updatedAt: 88 });
  });

  it("FR-015 a plan with nothing to rewrite is returned as is", async () => {
    const { rewritePlanColors } = await import("../../../../src/domain/export/merge");
    const plan = mergeImport(local(), incoming({ tasks: [mk({ titleMd: "plain" })] }), ctx);
    expect(rewritePlanColors(plan).taskUpserts[0]).toBe(plan.taskUpserts[0]);
  });
});

describe("015 history events on import (FR-023, research §6; T031)", () => {
  const ev = (k: string, taskId: string, at: number, detail: number | null = null) => ({ id: k, taskId, kind: "done" as const, at, detail });

  it("keeps an incoming event whose task is in the result, whichever task row wins", () => {
    const mine = mk({ id: id(1), updatedAt: 10 });
    const theirs = { ...mine, updatedAt: 5 };
    const plan = mergeImport(local({ tasks: [mine] }), incoming({ tasks: [theirs], taskEvents: [ev("e1", id(1), 7)] }), ctx);
    expect(plan.taskUpserts).toEqual([]);
    expect(plan.eventUpserts).toEqual([ev("e1", id(1), 7)]);
  });

  it("adds the events of a new task", () => {
    const t = mk({ id: id(2) });
    expect(mergeImport(local(), incoming({ tasks: [t], taskEvents: [ev("e2", id(2), 3)] }), ctx).eventUpserts).toEqual([ev("e2", id(2), 3)]);
  });

  it("on an id clash the later `at` wins; the same event again adds nothing (SC-005)", () => {
    const t = mk({ id: id(3) });
    const stored = { id: "e3", taskId: id(3), kind: "override_set" as const, at: 50, detail: 120 };
    const older = { ...stored, at: 40, detail: 60 };
    const newer = { ...stored, at: 60, detail: 180 };
    const base = local({ tasks: [t], events: [stored] });
    expect(mergeImport(base, incoming({ tasks: [t], taskEvents: [older] }), ctx).eventUpserts).toEqual([]);
    expect(mergeImport(base, incoming({ tasks: [t], taskEvents: [stored] }), ctx).eventUpserts).toEqual([]);
    expect(mergeImport(base, incoming({ tasks: [t], taskEvents: [newer] }), ctx).eventUpserts).toEqual([newer]);
  });

  it("drops the events of a task in neither side", () => {
    expect(mergeImport(local(), incoming({ taskEvents: [ev("e4", id(9), 1)] }), ctx).eventUpserts).toEqual([]);
  });

  it("an export from before 015 has no events: nothing to merge", () => {
    expect(mergeImport(local(), incoming({ tasks: [mk({ id: id(5) })] }), ctx).eventUpserts).toEqual([]);
  });

  it("merges the four quick durations per key by updatedAt", () => {
    const mineQ: ExportSetting = { key: "quickReschedule2Min", value: 120, updatedAt: 10 };
    const theirsQ: ExportSetting = { key: "quickReschedule2Min", value: 180, updatedAt: 20 };
    expect(mergeImport(local({ settings: [mineQ] }), incoming({ settings: [theirsQ] }), ctx).settingUpserts).toEqual([theirsQ]);
  });
});

describe("018 FR-016a an import only makes a cleanup keep more (PRD Q280)", () => {
  const upserts = (mine: ExportSetting[], theirs: ExportSetting[]) => mergeImport(local({ settings: mine }), incoming({ settings: theirs }), ctx).settingUpserts;
  const row = (key: string, value: unknown, updatedAt: number): ExportSetting => ({ key, value, updatedAt }) as ExportSetting;

  it("takes a newer switch turned off and ignores a newer switch turned on", () => {
    expect(upserts([row("archiveCleanupOn", true, 5)], [row("archiveCleanupOn", false, 9)])).toEqual([row("archiveCleanupOn", false, 9)]);
    expect(upserts([row("archiveCleanupOn", false, 5)], [row("archiveCleanupOn", true, 9)])).toEqual([]);
  });

  it("takes a newer longer time, ignores a newer shorter time and an older longer one", () => {
    expect(upserts([row("trashCleanupHours", 720, 5)], [row("trashCleanupHours", 1000, 9)])).toEqual([row("trashCleanupHours", 1000, 9)]);
    expect(upserts([row("trashCleanupHours", 720, 5)], [row("trashCleanupHours", 100, 9)])).toEqual([]);
    expect(upserts([row("trashCleanupHours", 720, 9)], [row("trashCleanupHours", 1000, 5)])).toEqual([]);
  });

  it("a longer time with the switch turned on takes the time and keeps the local switch", () => {
    const out = upserts(
      [row("trashCleanupOn", false, 5), row("trashCleanupHours", 720, 5)],
      [row("trashCleanupOn", true, 9), row("trashCleanupHours", 2000, 9)],
    );
    expect(out).toEqual([row("trashCleanupHours", 2000, 9)]);
  });
});
