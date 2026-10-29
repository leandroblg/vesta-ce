/**
 * Restoring the pre-import backup at runtime (008 research §4; FR-037, FR-037b). The backup's tables are copied
 * back over the live ones in one transaction on the same connection (ATTACH), so every module keeps its handle
 * and prepared statements. The backup locks (`backup_assets`) are left as they are.
 */
import { existsSync } from "node:fs";
import type Database from "better-sqlite3";
import { faultActive } from "../faults";
import { backupFile } from "./backup";

/** Parents before children, so the one-level triggers and the foreign key see each parent first. */
const TABLES: readonly { name: string; order: string }[] = [
  { name: "tasks", order: "parent_id is not null, rowid" },
  { name: "reminders", order: "rowid" },
  { name: "settings", order: "rowid" },
  { name: "assets", order: "rowid" },
];

function columns(db: Database.Database, schema: "main" | "pre", table: string): string[] {
  return (db.prepare(`pragma ${schema}.table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

/** Throws on any failure; the transaction then leaves the data as it was. */
export function restoreFromPreImport(db: Database.Database, dataDir: string): void {
  if (faultActive("undo-restore")) throw new Error("VESTA_FAULT=undo-restore");
  const file = backupFile(dataDir, "pre-import");
  if (!existsSync(file)) throw new Error("no pre-import backup");
  db.prepare("attach database ? as pre").run(file);
  try {
    db.transaction(() => {
      for (const { name } of [...TABLES].reverse()) db.prepare(`delete from main.${name}`).run();
      for (const { name, order } of TABLES) {
        const preColumns = new Set(columns(db, "pre", name));
        const shared = columns(db, "main", name).filter((c) => preColumns.has(c)).join(", ");
        db.prepare(`insert into main.${name} (${shared}) select ${shared} from pre.${name} order by ${order}`).run();
      }
    })();
  } finally {
    db.prepare("detach database pre").run();
  }
}
