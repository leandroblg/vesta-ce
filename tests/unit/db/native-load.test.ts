import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/main/db/connection";

describe("better-sqlite3 native module", () => {
  it("loads in the test runtime and reports its SQLite version", () => {
    const db = new Database(":memory:");
    const row = db.prepare("select sqlite_version() as v").get() as { v: string };
    db.close();
    expect(row.v).toMatch(/^3\.\d+\.\d+$/);
  });
});

describe("FTS5 with the trigram tokenizer (006 T002, research §0, §4)", () => {
  it("finds a substring through a trigram index and passes the integrity check", () => {
    const db = openDatabase(":memory:");
    db.exec("create virtual table t using fts5(a, tokenize = 'trigram')");
    db.prepare("insert into t (a) values (?)").run("passport");
    const rows = db.prepare(`select a from t where t match '"ssp"'`).all() as { a: string }[];
    const check = db.pragma("integrity_check") as { integrity_check: string }[];
    db.close();
    expect(rows.map((r) => r.a)).toEqual(["passport"]);
    expect(check).toEqual([{ integrity_check: "ok" }]);
  });
});
