import { describe, expect, it } from "vitest";
import {
  INFO_MS,
  UNDO_MS,
  initialNotifications,
  reduce,
  visible,
  visibleImportUndoToken,
  visibleRedoToken,
  visibleUndoToken,
  type NotificationState,
} from "../../../src/domain/notifications";

const T0 = 1_000_000;

function run(events: Parameters<typeof reduce>[1][], start: NotificationState = initialNotifications, now = T0) {
  return events.reduce((s, e) => reduce(s, e, now), start);
}

describe("notification reducer (research.md §10)", () => {
  it("starts empty", () => {
    expect(visible(initialNotifications)).toBeNull();
  });

  it("shows an undo notification and replaces it with a newer one (FR-028)", () => {
    const s = run([
      { type: "showUndo", kind: "done", token: "a" },
      { type: "showUndo", kind: "delete", token: "b" },
    ]);
    expect(visible(s)).toMatchObject({ type: "undo", kind: "delete", token: "b" });
  });

  it("expires an undo after 10 s, whatever the hover state (FR-027)", () => {
    let s = run([{ type: "showUndo", kind: "done", token: "a" }]);
    s = reduce(s, { type: "tick" }, T0 + UNDO_MS - 1);
    expect(visible(s)).not.toBeNull();
    s = reduce(s, { type: "tick" }, T0 + UNDO_MS);
    expect(visible(s)).toBeNull();
    expect(UNDO_MS).toBe(10_000);
  });

  it("close removes the visible notification", () => {
    const s = run([{ type: "showUndo", kind: "done", token: "a" }, { type: "close" }]);
    expect(visible(s)).toBeNull();
  });

  it("drops an undo requested while a sticky shows (FR-028)", () => {
    const s = run([
      { type: "showSticky", kind: "saveFailed" },
      { type: "showUndo", kind: "done", token: "a" },
    ]);
    expect(visible(s)).toMatchObject({ type: "sticky", kind: "saveFailed" });
    expect(visible(reduce(s, { type: "close" }, T0))).toBeNull();
  });

  it("saveFailed replaces an undo (FR-040)", () => {
    const s = run([
      { type: "showUndo", kind: "done", token: "a" },
      { type: "showSticky", kind: "saveFailed" },
    ]);
    expect(visible(s)).toMatchObject({ type: "sticky", kind: "saveFailed" });
  });

  it("a second saveFailed while one is visible or waiting adds nothing (FR-040)", () => {
    let s = run([
      { type: "showSticky", kind: "saveFailed" },
      { type: "showSticky", kind: "saveFailed" },
    ]);
    s = reduce(s, { type: "close" }, T0);
    expect(visible(s)).toBeNull();

    s = run([
      { type: "showSticky", kind: "folderNotWritable", path: "/x" },
      { type: "showSticky", kind: "saveFailed" },
      { type: "showSticky", kind: "saveFailed" },
    ]);
    s = reduce(s, { type: "close" }, T0);
    expect(visible(s)).toMatchObject({ kind: "saveFailed" });
    s = reduce(s, { type: "close" }, T0);
    expect(visible(s)).toBeNull();
  });

  it("dataDamaged and backupRestored replace whatever shows (FR-041b, FR-042)", () => {
    let s = run([
      { type: "showSticky", kind: "saveFailed" },
      { type: "showSticky", kind: "dataDamaged" },
    ]);
    expect(visible(s)).toMatchObject({ kind: "dataDamaged" });

    s = run([
      { type: "showUndo", kind: "done", token: "a" },
      { type: "showSticky", kind: "backupRestored", backupAt: 5, moved: null },
    ]);
    expect(visible(s)).toMatchObject({ kind: "backupRestored", backupAt: 5 });
  });

  it("other stickies arriving while a sticky shows wait and appear after it is closed", () => {
    let s = run([
      { type: "showSticky", kind: "backupRestored", backupAt: 5, moved: null },
      { type: "showSticky", kind: "folderNotWritable", path: "/data" },
      { type: "showSticky", kind: "saveFailed" },
    ]);
    expect(visible(s)).toMatchObject({ kind: "backupRestored" });
    s = reduce(s, { type: "close" }, T0);
    expect(visible(s)).toMatchObject({ kind: "folderNotWritable", path: "/data" });
    s = reduce(s, { type: "close" }, T0);
    expect(visible(s)).toMatchObject({ kind: "saveFailed" });
    s = reduce(s, { type: "close" }, T0);
    expect(visible(s)).toBeNull();
  });

  it("does not let an undo or info replace a sticky", () => {
    const s = run([
      { type: "showSticky", kind: "unrecoverable", damagedPath: "/d" },
      { type: "showUndo", kind: "restore", token: "x" },
      { type: "showInfo", kind: "backupFailed", lastBackupAt: 1 },
    ]);
    expect(visible(s)).toMatchObject({ kind: "unrecoverable" });
  });

  it("backupFailed info shows for 10 s and waits for a free slot (FR-041a)", () => {
    let s = run([
      { type: "showUndo", kind: "done", token: "a" },
      { type: "showInfo", kind: "backupFailed", lastBackupAt: 7 },
    ]);
    expect(visible(s)).toMatchObject({ type: "undo" });
    s = reduce(s, { type: "tick" }, T0 + UNDO_MS);
    expect(visible(s)).toMatchObject({ type: "info", kind: "backupFailed", lastBackupAt: 7 });
    s = reduce(s, { type: "tick" }, T0 + UNDO_MS + INFO_MS - 1);
    expect(visible(s)).not.toBeNull();
    s = reduce(s, { type: "tick" }, T0 + UNDO_MS + INFO_MS);
    expect(visible(s)).toBeNull();
  });

  it("an undo shown over an info puts the info back to wait", () => {
    let s = run([
      { type: "showInfo", kind: "backupFailed", lastBackupAt: 7 },
      { type: "showUndo", kind: "done", token: "a" },
    ]);
    expect(visible(s)).toMatchObject({ type: "undo" });
    s = reduce(s, { type: "close" }, T0 + 1000);
    expect(visible(s)).toMatchObject({ type: "info", shownAt: T0 + 1000 });
  });

  it("a sticky shown over an info puts the info back to wait", () => {
    let s = run([{ type: "showInfo", kind: "backupFailed", lastBackupAt: null }]);
    s = reduce(s, { type: "showSticky", kind: "folderNotWritable", path: "/p" }, T0);
    expect(visible(s)).toMatchObject({ kind: "folderNotWritable" });
    s = reduce(s, { type: "close" }, T0 + 5);
    expect(visible(s)).toMatchObject({ type: "info", kind: "backupFailed", shownAt: T0 + 5 });
  });
});

describe("the importUndo notice (008 FR-037b, PRD Q121)", () => {
  const counts = { added: 2, updated: 1, unchanged: 0 };
  const showImport = (deadline: number) => ({ type: "showImportUndo", token: "imp", counts, deadline }) as const;

  it("shows with its counts and token until its 60 s deadline, not 10 s", () => {
    const s = reduce(initialNotifications, showImport(60_000), 0);
    expect(s.current).toEqual({ type: "importUndo", token: "imp", counts, shownAt: 0, deadline: 60_000 });
    expect(reduce(s, { type: "tick" }, 10_000).current?.type).toBe("importUndo");
    expect(reduce(s, { type: "tick" }, 59_999).current?.type).toBe("importUndo");
    expect(reduce(s, { type: "tick" }, 60_000).current).toBeNull();
  });

  it("replaces a showing undo notice, and is replaced by a later one", () => {
    const undo = reduce(initialNotifications, { type: "showUndo", kind: "done", token: "u" }, 0);
    const imp = reduce(undo, showImport(60_000), 1);
    expect(imp.current?.type).toBe("importUndo");
    expect(imp.waiting).toEqual([]);
    const later = reduce(imp, { type: "showUndo", kind: "delete", token: "u2" }, 2);
    expect(later.current).toMatchObject({ type: "undo", token: "u2" });
    expect(later.waiting).toEqual([]);
  });

  it("is replaced by Changes are not saved and by a replacing sticky, and does not come back", () => {
    const imp = reduce(initialNotifications, showImport(60_000), 0);
    const failed = reduce(imp, { type: "showSticky", kind: "saveFailed" }, 1);
    expect(failed.current).toEqual({ type: "sticky", kind: "saveFailed" });
    expect(reduce(failed, { type: "close" }, 2).current).toBeNull();
    expect(reduce(imp, { type: "showSticky", kind: "dataDamaged" }, 1).current).toEqual({ type: "sticky", kind: "dataDamaged" });
  });

  it("keeps showing while an info notice waits", () => {
    const imp = reduce(initialNotifications, showImport(60_000), 0);
    const s = reduce(imp, { type: "showInfo", kind: "backupFailed", lastBackupAt: null }, 1);
    expect(s.current?.type).toBe("importUndo");
    expect(s.waiting).toHaveLength(1);
  });

  it("closes with its close button", () => {
    expect(reduce(reduce(initialNotifications, showImport(60_000), 0), { type: "close" }, 5).current).toBeNull();
  });

  it("gives its place to Import undone or the undo failure, each for 10 s", () => {
    const imp = reduce(initialNotifications, showImport(60_000), 0);
    const undone = reduce(imp, { type: "importUndone" }, 5);
    expect(undone.current).toEqual({ type: "importResult", kind: "undone", shownAt: 5 });
    expect(reduce(undone, { type: "tick" }, 10_005).current).toBeNull();
    expect(reduce(imp, { type: "importUndoFailed" }, 5).current).toEqual({ type: "importResult", kind: "undoFailed", shownAt: 5 });
  });

  it("is never the token Cmd/Ctrl+Z undoes", () => {
    const s = reduce(initialNotifications, showImport(60_000), 0);
    expect(visibleUndoToken(s)).toBeNull();
    expect(visibleImportUndoToken(s)).toBe("imp");
  });
});

describe("the update notice (009 FR-024, FR-024a; spec edge cases)", () => {
  const show = { type: "showUpdate", version: "0.2.0" } as const;

  it("shows in an empty slot until closed, and never expires", () => {
    let s = run([show]);
    expect(visible(s)).toMatchObject({ type: "update", version: "0.2.0" });
    s = reduce(s, { type: "tick" }, T0 + 24 * 3_600_000);
    expect(visible(s)).toMatchObject({ type: "update" });
    s = reduce(s, { type: "close" }, T0 + 1);
    expect(visible(s)).toBeNull();
  });

  it("waits while an undo, info, import or sticky notice shows, and never replaces it", () => {
    for (const first of [
      { type: "showUndo", kind: "done", token: "u" },
      { type: "showInfo", kind: "backupFailed", lastBackupAt: null },
      { type: "showImportUndo", token: "i", counts: { added: 1, updated: 0, unchanged: 0 }, deadline: T0 + 60_000 },
      { type: "showSticky", kind: "saveFailed" },
    ] as const) {
      let s = run([first, show]);
      expect(visible(s)?.type, first.type).not.toBe("update");
      s = reduce(s, { type: "close" }, T0 + 1);
      expect(visible(s), first.type).toMatchObject({ type: "update", version: "0.2.0" });
    }
  });

  it("goes back to the queue when a later notice displaces it, and returns after that one", () => {
    let s = run([show, { type: "showUndo", kind: "delete", token: "u" }]);
    expect(visible(s)).toMatchObject({ type: "undo" });
    s = reduce(s, { type: "tick" }, T0 + UNDO_MS);
    expect(visible(s)).toMatchObject({ type: "update" });
    s = run([show, { type: "showSticky", kind: "dataDamaged" }]);
    expect(visible(s)).toMatchObject({ type: "sticky", kind: "dataDamaged" });
    s = reduce(s, { type: "close" }, T0 + 1);
    expect(visible(s)).toMatchObject({ type: "update" });
  });

  it("dropUpdate removes it from the slot or from the queue (Settings opened)", () => {
    let s = run([show, { type: "dropUpdate" }]);
    expect(visible(s)).toBeNull();
    s = run([{ type: "showSticky", kind: "saveFailed" }, show, { type: "dropUpdate" }]);
    s = reduce(s, { type: "close" }, T0 + 1);
    expect(visible(s)).toBeNull();
  });

  it("a newer version replaces a waiting or showing older one instead of stacking", () => {
    let s = run([show, { type: "showUpdate", version: "0.3.0" }]);
    expect(visible(s)).toMatchObject({ type: "update", version: "0.3.0" });
    s = reduce(s, { type: "close" }, T0 + 1);
    expect(visible(s)).toBeNull();
    s = run([{ type: "showSticky", kind: "saveFailed" }, show, { type: "showUpdate", version: "0.3.0" }]);
    s = reduce(s, { type: "close" }, T0 + 1);
    expect(visible(s)).toMatchObject({ type: "update", version: "0.3.0" });
    s = reduce(s, { type: "close" }, T0 + 2);
    expect(visible(s)).toBeNull();
  });
});

describe("L16 the abnormal-exit sticky (010 FR-026)", () => {
  it("L16 shows, stays through ticks and closes on demand", () => {
    let s = run([{ type: "showSticky", kind: "abnormalExit", at: 5 }]);
    expect(visible(s)).toEqual({ type: "sticky", kind: "abnormalExit", at: 5 });
    s = reduce(s, { type: "tick" }, T0 + 60_000);
    expect(visible(s)).toMatchObject({ kind: "abnormalExit" });
    s = reduce(s, { type: "close" }, T0 + 60_001);
    expect(visible(s)).toBeNull();
  });

  it("L16 a restore or damage notice replaces it (A7 precedence)", () => {
    const s = run([
      { type: "showSticky", kind: "abnormalExit", at: 5 },
      { type: "showSticky", kind: "backupRestored", backupAt: 1, moved: null },
    ]);
    expect(visible(s)).toMatchObject({ kind: "backupRestored" });
    const t = run([
      { type: "showSticky", kind: "abnormalExit", at: 5 },
      { type: "showSticky", kind: "dataDamaged" },
    ]);
    expect(visible(t)).toMatchObject({ kind: "dataDamaged" });
  });

  it("L16 waits behind another sticky and shows when it closes", () => {
    let s = run([
      { type: "showSticky", kind: "saveFailed" },
      { type: "showSticky", kind: "abnormalExit", at: 5 },
    ]);
    expect(visible(s)).toMatchObject({ kind: "saveFailed" });
    s = reduce(s, { type: "close" }, T0 + 1);
    expect(visible(s)).toMatchObject({ kind: "abnormalExit" });
  });
});

describe("Q133 the update reminder notice (010 FR-033)", () => {
  it("Q133 shows when the slot is free and stays until closed", () => {
    let s = run([{ type: "showReminder" }]);
    expect(visible(s)).toEqual({ type: "reminder", shownAt: T0 });
    s = reduce(s, { type: "tick" }, T0 + 3_600_000);
    expect(visible(s)).toMatchObject({ type: "reminder" });
    s = reduce(s, { type: "close" }, T0 + 3_600_001);
    expect(visible(s)).toBeNull();
  });

  it("Q133 waits behind a visible notice and never replaces one", () => {
    let s = run([
      { type: "showUndo", kind: "done", token: "a" },
      { type: "showReminder" },
    ]);
    expect(visible(s)).toMatchObject({ type: "undo" });
    s = reduce(s, { type: "tick" }, T0 + UNDO_MS + 1);
    expect(visible(s)).toMatchObject({ type: "reminder" });
  });

  it("Q133 goes back to waiting when a sticky displaces it, and dropReminder removes it anywhere", () => {
    let s = run([{ type: "showReminder" }, { type: "showSticky", kind: "saveFailed" }]);
    expect(visible(s)).toMatchObject({ kind: "saveFailed" });
    expect(s.waiting.some((w) => w.type === "reminder")).toBe(true);
    s = reduce(s, { type: "dropReminder" }, T0 + 1);
    expect(s.waiting.some((w) => w.type === "reminder")).toBe(false);
    let t = run([{ type: "showReminder" }]);
    t = reduce(t, { type: "dropReminder" }, T0 + 1);
    expect(visible(t)).toBeNull();
  });
});

describe("016 the redo notice (FR-003, FR-006, Q256)", () => {
  const redo = { type: "showRedo", token: "r", title: "Fix bike" } as const;
  it("shows after an undo with its token and title, and is not an undo token", () => {
    const s = run([{ type: "showUndo", kind: "reschedule", token: "u" }, redo]);
    expect(visible(s)).toMatchObject({ type: "redo", token: "r", title: "Fix bike" });
    expect(visibleRedoToken(s)).toBe("r");
    expect(visibleUndoToken(s)).toBeNull();
  });
  it("expires after UNDO_MS", () => {
    let s = run([redo]);
    s = reduce(s, { type: "tick" }, T0 + UNDO_MS - 1);
    expect(visibleRedoToken(s)).toBe("r");
    s = reduce(s, { type: "tick" }, T0 + UNDO_MS);
    expect(visible(s)).toBeNull();
  });
  it("is replaced by a new undo, an import notice or a sticky, and does not come back", () => {
    for (const e of [
      { type: "showUndo", kind: "done", token: "u2" },
      { type: "showImportUndo", token: "i", counts: { added: 1, updated: 0, unchanged: 0 }, deadline: T0 + 60_000 },
      { type: "showSticky", kind: "saveFailed" },
    ] as const) {
      const s = run([redo, e, { type: "close" }]);
      expect(visibleRedoToken(s), e.type).toBeNull();
    }
  });
  it("is dismissed by any other list action, which leaves an undo notice alone", () => {
    expect(visible(run([redo, { type: "listAction" }]))).toBeNull();
    expect(visibleUndoToken(run([{ type: "showUndo", kind: "reschedule", token: "u" }, { type: "listAction" }]))).toBe("u");
  });
  it("is not shown over a sticky", () => {
    const s = run([{ type: "showSticky", kind: "saveFailed" }, redo]);
    expect(visibleRedoToken(s)).toBeNull();
  });
});

describe("the newer-data notice (017 FR-015a, PRD Q263, Q269)", () => {
  it("stays until closed", () => {
    const s = run([{ type: "showSticky", kind: "newerData" }, { type: "tick" }]);
    expect(visible(s)).toEqual({ type: "sticky", kind: "newerData" });
  });

  it("gives way to “Changes are not saved” and comes back when that is closed (Q269)", () => {
    let s = run([{ type: "showSticky", kind: "newerData" }, { type: "showSticky", kind: "saveFailed" }]);
    expect(visible(s)).toMatchObject({ type: "sticky", kind: "saveFailed" });
    s = reduce(s, { type: "showSticky", kind: "saveFailed" }, T0 + 1);
    expect(visible(s)).toMatchObject({ type: "sticky", kind: "saveFailed" });
    s = reduce(s, { type: "close" }, T0 + 2);
    expect(visible(s)).toEqual({ type: "sticky", kind: "newerData" });
    expect(s.waiting).toEqual([]);
  });

  it("leaves another sticky's queueing as it was", () => {
    const s = run([{ type: "showSticky", kind: "folderNotWritable", path: "/p" }, { type: "showSticky", kind: "saveFailed" }]);
    expect(visible(s)).toMatchObject({ kind: "folderNotWritable" });
  });
});
