import { describe, expect, it } from "vitest";
import en from "../../../src/shared/i18n/locales/en.json";
import { t } from "../../../src/renderer/i18n/t";

describe("t() (minimal stand-in for i18next, feature 007)", () => {
  it("returns the English string for a key", () => {
    expect(t("newTaskPh")).toBe("New task…");
    expect(t("toastDone", { t: "Fix bike" })).toBe("“Fix bike” moved to the Archive.");
  });

  it("replaces {name} placeholders", () => {
    expect(t("daysLeft", { count: 12 })).toBe("12 days left");
    expect(t("daysLeft", { count: 1 })).toBe("1 day left");
    expect(t("markDone", { t: "Renew passport" })).toBe("Mark done: Renew passport");
  });

  it("returns the key for an unknown key without throwing", () => {
    expect(t("noSuchKey" as never)).toBe("noSuchKey");
  });

  it("keeps the prototype's copy for the notification texts (FR-025, FR-040)", () => {
    expect(en.toastTrash).toBe("“{t}” moved to the Trash.");
    expect(en.toastRestored).toBe("“{t}” restored.");
    expect(en.undoLink).toBe("Undo");
    expect(en.saveFail).toBe("Changes are not saved");
  });

  it("has the prototype's 005 copy (panel, menu, files)", () => {
    expect(t("saved")).toBe("Saved");
    expect(t("panelSaveFail")).toBe("Changes not saved");
    expect(t("fmAll_details")).toBe("All details");
    expect(t("fileTooBig", { n: "movie.mov" })).toBe("“movie.mov” is larger than 100 MB and was not added.");
    expect(t("linkHint", { k: "Cmd" })).toBe("Cmd+click to open");
    expect(t("detailsPh")).toBe("Add details: notes, links, checklists, tables, code…");
  });
});

describe("015 FR-016c history times follow the system's time zone; their order does not (analysis G2)", () => {
  it("the same instants shift by the zones' offset, and historyOf's order stays the same", async () => {
    const { formatTime } = await import("../../../src/renderer/i18n/t");
    const { historyOf } = await import("../../../src/domain/task-events");
    const { mk } = await import("../domain/fixtures");
    const created = Date.UTC(2026, 9, 20, 12, 0);
    const done = Date.UTC(2026, 9, 20, 15, 30);
    const task = mk({ createdAt: created, doneAt: done });
    const before = process.env["TZ"];
    try {
      process.env["TZ"] = "America/Sao_Paulo";
      const sp = [formatTime(created), formatTime(done)];
      const spOrder = historyOf(task, []).map((e) => e.kind);
      process.env["TZ"] = "Europe/Lisbon";
      const lx = [formatTime(created), formatTime(done)];
      expect(sp).toEqual(["9:00 AM", "12:30 PM"]);
      expect(lx).toEqual(["1:00 PM", "4:30 PM"]);
      expect(historyOf(task, []).map((e) => e.kind)).toEqual(spOrder);
    } finally {
      if (before === undefined) delete process.env["TZ"];
      else process.env["TZ"] = before;
    }
  });
});
