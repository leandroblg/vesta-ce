// T013: the SQL functions the search triggers call (006 data-model "SQL functions", research §4).
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/main/db/connection";
import { registerSearchFunctions } from "../../../src/main/db/search-functions";
import { tempDir } from "./helpers";

const SQLITE_DETERMINISTIC = 0x800;
const one = (db: Database.Database, sql: string, ...args: unknown[]) => (db.prepare(sql).pluck().get(...args));

describe("search SQL functions", () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it("openDatabase registers both on writable and read-only connections", () => {
    const path = join(dir, "data.sqlite");
    const rw = openDatabase(path);
    expect(one(rw, "select vesta_search_plain(?, 'details')", "**Renew** [passport](https://x.example)")).toBe("Renew passport");
    expect(one(rw, "select vesta_search_plain(?, 'title')", "<b>x</b>")).toBe("<b>x</b>");
    expect(one(rw, "select vesta_search_key(?)", "Ação Résumé")).toBe("acao resume");
    rw.close();
    const ro = openDatabase(path, { readonly: true });
    expect(one(ro, "select vesta_search_key(?)", "ÉTÉ")).toBe("ete");
    ro.close();
  });

  it("registers them as deterministic", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    for (const name of ["vesta_search_plain", "vesta_search_key"]) {
      const flags = one(db, "select flags from pragma_function_list where name = ?", name) as number;
      expect(flags & SQLITE_DETERMINISTIC).toBe(SQLITE_DETERMINISTIC);
    }
    db.close();
  });

  it("treats NULL as empty text", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    expect(one(db, "select vesta_search_plain(null, 'details')")).toBe("");
    expect(one(db, "select vesta_search_key(null)")).toBe("");
    db.close();
  });

  it("never makes the statement fail: a parse error gives the collapsed markdown and is logged", () => {
    const db = new Database(":memory:");
    const logged: string[] = [];
    registerSearchFunctions(db, {
      parse: () => {
        throw new Error("boom");
      },
      logError: (event) => logged.push(event),
    });
    expect(one(db, "select vesta_search_plain(?, 'details')", "  **a**\n\nb ")).toBe("**a** b");
    expect(logged).toEqual(["search.extract-failed"]);
    db.close();
  });
});
