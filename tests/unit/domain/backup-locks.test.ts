import { describe, expect, it } from "vitest";
import { afterBackup, onUnreferenced, type Lock } from "../../../src/domain/backup-locks";

const p = (c: string, ext = "png") => (ext === "" ? `assets/${c.repeat(64)}` : `assets/${c.repeat(64)}.${ext}`);
const LATEST = "backups/latest.sqlite";

describe("backup locks (005 FR-032a)", () => {
  it("afterBackup: the backup's locks are exactly its refs, deduped and valid", () => {
    const out = afterBackup({
      backup: LATEST,
      refs: [p("a"), p("b", ""), p("a"), "assets/../x", "https://x"],
      existingBackups: [LATEST],
      locks: [{ backup: LATEST, path: p("c") }],
      tagged: [],
    });
    expect(out.locks).toEqual([
      { backup: LATEST, path: p("a") },
      { backup: LATEST, path: p("b", "") },
    ]);
    expect(out.deleteNow).toEqual([]);
  });

  it("afterBackup: drops the locks of backups that no longer exist", () => {
    const locks: Lock[] = [
      { backup: "backups/old.sqlite", path: p("a") },
      { backup: "backups/kept.sqlite", path: p("b") },
    ];
    const out = afterBackup({
      backup: LATEST,
      refs: [],
      existingBackups: [LATEST, "backups/kept.sqlite"],
      locks,
      tagged: [],
    });
    expect(out.locks).toEqual([{ backup: "backups/kept.sqlite", path: p("b") }]);
  });

  it("afterBackup: deletes tagged files no lock lists any more, keeps those another backup still lists", () => {
    const out = afterBackup({
      backup: LATEST,
      refs: [p("c")],
      existingBackups: [LATEST, "backups/kept.sqlite"],
      locks: [
        { backup: LATEST, path: p("a") },
        { backup: "backups/kept.sqlite", path: p("b") },
      ],
      tagged: [p("a"), p("b"), p("c"), p("d", "")],
    });
    expect(out.deleteNow).toEqual([p("a"), p("d", "")]);
    expect(out.locks).toEqual([
      { backup: "backups/kept.sqlite", path: p("b") },
      { backup: LATEST, path: p("c") },
    ]);
  });

  it("afterBackup: a backup listed twice in existingBackups changes nothing", () => {
    const out = afterBackup({
      backup: LATEST,
      refs: [p("a")],
      existingBackups: [LATEST, LATEST],
      locks: [],
      tagged: [],
    });
    expect(out.locks).toEqual([{ backup: LATEST, path: p("a") }]);
  });

  it("onUnreferenced: delete when no lock lists the path, else tag", () => {
    const locks: Lock[] = [{ backup: LATEST, path: p("a") }];
    expect(onUnreferenced(p("a"), locks)).toBe("tag");
    expect(onUnreferenced(p("b"), locks)).toBe("delete");
    expect(onUnreferenced(p("c", ""), [{ backup: LATEST, path: p("c", "") }])).toBe("tag");
  });
});

describe("backup locks by hash (008 research §9)", () => {
  it("onUnreferenced treats .jpg and .jpeg of the same hash as one file", () => {
    expect(onUnreferenced(p("a", "jpeg"), [{ backup: LATEST, path: p("a", "jpg") }])).toBe("tag");
    expect(onUnreferenced(p("a", "jpeg"), [{ backup: LATEST, path: p("b", "jpeg") }])).toBe("delete");
  });

  it("afterBackup keeps a tagged file that a lock lists under another extension", () => {
    const out = afterBackup({ backup: LATEST, refs: [p("a", "jpg")], existingBackups: [LATEST], locks: [], tagged: [p("a", "jpeg"), p("b")] });
    expect(out.deleteNow).toEqual([p("b")]);
  });
});
