/**
 * The search index's database side (006 research §4, §5): rows the background fill still has to index,
 * writing its results, and finding query candidates.
 */
import type Database from "better-sqlite3";
import type { Extracted, IndexItem } from "../search/extract";

/** Tasks first, then reminders: items with no `search_docs` row, or with a pending one (large details). */
export function nextUnindexed(db: Database.Database, limit: number): IndexItem[] {
  const tasks = db
    .prepare(
      `select t.id, t.title_md, t.details_md from tasks t
       left join search_docs d on d.kind = 'task' and d.item_id = t.id
       where d.rowid is null or d.pending = 1
       limit ?`,
    )
    .all(limit) as { id: string; title_md: string; details_md: string }[];
  const items: IndexItem[] = tasks.map((r) => ({ kind: "task", id: r.id, titleMd: r.title_md, detailsMd: r.details_md }));
  if (items.length < limit) {
    const reminders = db
      .prepare(
        `select r.id, r.text_md from reminders r
         left join search_docs d on d.kind = 'reminder' and d.item_id = r.id
         where d.rowid is null or d.pending = 1
         limit ?`,
      )
      .all(limit - items.length) as { id: string; text_md: string }[];
    for (const r of reminders) items.push({ kind: "reminder", id: r.id, titleMd: r.text_md, detailsMd: "" });
  }
  return items;
}

/** True while any item is missing from the index or waits for its details (search:query answers `pending`). */
export function isIndexPending(db: Database.Database): boolean {
  const row = db
    .prepare(
      `select exists(select 1 from search_docs where pending = 1)
           or exists(select 1 from tasks t where not exists (select 1 from search_docs d where d.kind = 'task' and d.item_id = t.id))
           or exists(select 1 from reminders r where not exists (select 1 from search_docs d where d.kind = 'reminder' and d.item_id = r.id))`,
    )
    .pluck()
    .get() as number;
  return row === 1;
}

const UPSERT = `
insert into search_docs (kind, item_id, title_plain, body_plain, title_key, body_key, pending)
values (@kind, @id, @titlePlain, @bodyPlain, @titleKey, @bodyKey, 0)
on conflict (kind, item_id) do update set
  title_plain = excluded.title_plain, body_plain = excluded.body_plain,
  title_key = excluded.title_key, body_key = excluded.body_key, pending = 0`;

/**
 * Writes extracted values in one transaction, skipping an item that was deleted or whose markdown changed
 * since it was read (its trigger already indexed it, or marked it pending again). Returns how many it wrote.
 */
export function writeExtracted(db: Database.Database, rows: readonly { item: IndexItem; ex: Extracted }[]): number {
  const taskMd = db.prepare("select title_md, details_md from tasks where id = ?");
  const reminderMd = db.prepare("select text_md from reminders where id = ?");
  const upsert = db.prepare(UPSERT);
  let written = 0;
  db.transaction(() => {
    for (const { item, ex } of rows) {
      if (item.kind === "task") {
        const cur = taskMd.get(item.id) as { title_md: string; details_md: string } | undefined;
        if (cur === undefined || cur.title_md !== item.titleMd || cur.details_md !== item.detailsMd) continue;
      } else {
        const cur = reminderMd.get(item.id) as { text_md: string } | undefined;
        if (cur === undefined || cur.text_md !== item.titleMd) continue;
      }
      upsert.run({ kind: item.kind, id: item.id, ...ex });
      written += 1;
    }
  })();
  return written;
}

export interface Candidate {
  kind: "task" | "reminder";
  item_id: string;
  title_plain: string;
  body_plain: string;
  title_key: string;
  body_key: string;
}

/** Length in characters (code points): trigrams are made of characters. */
function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

const quoteFts = (term: string): string => `"${term.replace(/"/g, '""')}"`;
const escapeLike = (term: string): string => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Rows that may match (research §5): FTS5 trigram MATCH for terms of 3 or more characters, an escaped LIKE
 * for shorter ones, filtered by status at query time. A superset; the domain matcher decides.
 * `keys` are folded (case- and accent-insensitive) terms.
 */
export function candidates(db: Database.Database, keys: readonly string[], includeArchiveTrash: boolean): Candidate[] {
  const long = keys.filter((k) => codePoints(k) >= 3);
  const short = keys.filter((k) => codePoints(k) < 3);
  const params: unknown[] = [];
  let sql = "select d.kind, d.item_id, d.title_plain, d.body_plain, d.title_key, d.body_key from search_docs d";
  if (long.length > 0) {
    sql += " join search_fts f on f.rowid = d.rowid and search_fts match ?";
    params.push(long.map(quoteFts).join(" AND "));
  }
  const where: string[] = [];
  for (const k of short) {
    where.push("(d.title_key like ? escape '\\' or d.body_key like ? escape '\\')");
    params.push(escapeLike(k), escapeLike(k));
  }
  const live = includeArchiveTrash ? "" : " and x.done_at is null and x.deleted_at is null";
  where.push(
    `((d.kind = 'task' and exists (select 1 from tasks x where x.id = d.item_id${live}))` +
      ` or (d.kind = 'reminder' and exists (select 1 from reminders x where x.id = d.item_id${live})))`,
  );
  sql += ` where ${where.join(" and ")}`;
  return db.prepare(sql).all(...params) as Candidate[];
}
