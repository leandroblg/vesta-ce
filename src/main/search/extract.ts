/**
 * Extraction for the background fill (006 research §2, §4): searchable text and folded keys for one item.
 * Pure apart from its domain imports, so the worker thread (worker.ts) and tests run the same code.
 */
import { fold } from "../../domain/search/fold";
import { searchableText } from "../../domain/search/searchable-text";

export interface IndexItem {
  kind: "task" | "reminder";
  id: string;
  titleMd: string;
  /** "" for reminders. */
  detailsMd: string;
}

export interface Extracted {
  titlePlain: string;
  bodyPlain: string;
  titleKey: string;
  bodyKey: string;
}

/** Turns a batch of items into their index values; production runs it in a worker thread. */
export type Extractor = (items: readonly IndexItem[]) => Promise<Extracted[]>;

export function extractItem(item: IndexItem): Extracted {
  const titlePlain = searchableText(item.titleMd, "title");
  const bodyPlain = item.kind === "task" ? searchableText(item.detailsMd, "details") : "";
  return {
    titlePlain,
    bodyPlain,
    titleKey: fold(titlePlain, { matchCase: false }).folded,
    bodyKey: fold(bodyPlain, { matchCase: false }).folded,
  };
}

export const inProcessExtractor: Extractor = (items) => Promise.resolve(items.map(extractItem));
