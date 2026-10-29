/**
 * The background fill (006 research §2, §4): indexes items with no `search_docs` row (the first start after
 * the update, a restored older backup) and rows marked pending (details over 100,000 characters). Extraction
 * runs through the extractor (a worker thread in production); main only writes each batch.
 */
import type Database from "better-sqlite3";
import { isIndexPending, nextUnindexed, writeExtracted } from "../db/search-repo";
import { errorMessage, type Logger } from "../log";
import type { Extractor } from "./extract";

export interface FillOptions {
  batchSize?: number;
  /** Called with the time main spent writing each batch (tests measure the budget). */
  onBatchWritten?: (ms: number) => void;
}

export interface Fill {
  /** Starts a pass at launch; the same as kick(). */
  start: () => void;
  /** Starts a pass if none is running; one running notices the request and passes again. */
  kick: () => void;
  isPending: () => boolean;
  /** Resolves when no pass is running (tests). */
  idle: () => Promise<void>;
}

const nextTick = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

export function createFill(
  db: () => Database.Database,
  extract: Extractor,
  onIndexed: () => void,
  log: Pick<Logger, "error" | "debug">,
  options: FillOptions = {},
): Fill {
  const batchSize = options.batchSize ?? 50;
  let running: Promise<void> | null = null;
  // Set by a kick while a pass runs; read through a function so the loop sees changes made during awaits.
  const request = { again: false };
  const wantsAgain = (): boolean => request.again;

  /** One pass until nothing is missing or pending; true when it indexed anything and finished cleanly. */
  async function pass(): Promise<boolean> {
    let didWork = false;
    for (;;) {
      const items = nextUnindexed(db(), batchSize);
      if (items.length === 0) return didWork;
      try {
        const extracted = await extract(items);
        const t0 = performance.now();
        writeExtracted(
          db(),
          items.flatMap((item, i) => {
            const ex = extracted[i];
            return ex === undefined ? [] : [{ item, ex }];
          }),
        );
        options.onBatchWritten?.(performance.now() - t0);
        log.debug("search.fill.batch", { rows: items.length, ms: Math.round(performance.now() - t0) });
      } catch (err) {
        log.error("search.fill-failed", { message: errorMessage(err), items: items.length });
        return false;
      }
      didWork = true;
      await nextTick();
    }
  }

  function kick(): void {
    if (running !== null) {
      request.again = true;
      return;
    }
    running = (async () => {
      let indexed = false;
      do {
        request.again = false;
        indexed = (await pass()) || indexed;
      } while (wantsAgain());
      running = null;
      if (indexed && !isIndexPending(db())) onIndexed();
    })();
  }

  return {
    start: kick,
    kick,
    isPending: () => isIndexPending(db()),
    idle: () => running ?? Promise.resolve(),
  };
}
