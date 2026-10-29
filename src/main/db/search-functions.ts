/**
 * The SQL functions the search triggers call (006 data-model "SQL functions", research §4). Registered on
 * every connection by openDatabase, and by the e2e seed fixture on its own writable connections. Insert and
 * update triggers need them; delete triggers do not.
 */
import type Database from "better-sqlite3";
import type { Root } from "mdast";
import { fold } from "../../domain/search/fold";
import { searchableText, type SearchScope } from "../../domain/search/searchable-text";
import { errorMessage, log } from "../log";

export interface SearchFunctionOptions {
  /** Replaceable parser, for tests. */
  parse?: (md: string) => Root;
  logError?: (event: string, fields: Record<string, unknown>) => void;
}

const asText = (v: unknown): string => (typeof v === "string" ? v : "");

export function registerSearchFunctions(db: Database.Database, options: SearchFunctionOptions = {}): void {
  const logError = options.logError ?? ((event, fields) => { log.error(event, fields); });
  db.function("vesta_search_plain", { deterministic: true }, (md: unknown, scope: unknown) => {
    const s: SearchScope = scope === "title" ? "title" : "details";
    return searchableText(asText(md), s, {
      ...(options.parse ? { parse: options.parse } : {}),
      onError: (err) => {
        logError("search.extract-failed", { scope: s, length: asText(md).length, message: errorMessage(err) });
      },
    });
  });
  db.function("vesta_search_key", { deterministic: true }, (text: unknown) => fold(asText(text), { matchCase: false }).folded);
}
