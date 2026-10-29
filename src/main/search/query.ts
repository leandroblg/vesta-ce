/**
 * The search:query handler (006 research §5): FTS5 narrows the candidates, the domain matcher decides, and
 * the excerpt is built for items that matched through their details. Read-only.
 */
import type Database from "better-sqlite3";
import { excerpt } from "../../domain/search/excerpt";
import { matchDoc, termKeys } from "../../domain/search/match";
import { parseQuery } from "../../domain/search/query";
import type { SearchMatch, SearchQuery, SearchResult } from "../../shared/ipc-contract";
import { candidates } from "../db/search-repo";
import { SaveFailedError } from "../db/tasks-repo";
import type { Logger } from "../log";

export function runSearchQuery(db: Database.Database, q: SearchQuery, pending: boolean, log: Pick<Logger, "error">): SearchResult {
  const opts = { matchCase: q.matchCase, exactPhrase: q.exactPhrase };
  const query = parseQuery(q.text, opts);
  if (query.terms.length === 0) return { seq: q.seq, matches: [], pending };
  try {
    // Candidates use the case-insensitive keys even with Match case: a superset the matcher narrows.
    const rows = candidates(db, termKeys(query, { matchCase: false, exactPhrase: q.exactPhrase }), q.includeArchiveTrash);
    const matches: SearchMatch[] = [];
    for (const row of rows) {
      const m = matchDoc(query, { titlePlain: row.title_plain, bodyPlain: row.body_plain, titleKey: row.title_key, bodyKey: row.body_key }, opts);
      if (!m.matched) continue;
      const ex = m.inTitle || row.kind !== "task" ? null : excerpt(row.body_plain, row.title_plain, query, opts);
      matches.push({ kind: row.kind, id: row.item_id, inTitle: m.inTitle, excerpt: ex });
    }
    return { seq: q.seq, matches, pending };
  } catch (err) {
    // Never log the search text (contracts/ipc.md): only the flags, the length and SQLite's code.
    const code = typeof err === "object" && err !== null && "code" in err ? String((err).code) : "unknown";
    log.error("search.query-failed", {
      length: q.text.length,
      matchCase: q.matchCase,
      exactPhrase: q.exactPhrase,
      includeArchiveTrash: q.includeArchiveTrash,
      code,
    });
    throw new SaveFailedError(new Error("search failed"));
  }
}
