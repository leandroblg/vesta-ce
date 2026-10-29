/**
 * Open editors register a commit callback here; closing the window or quitting runs them all
 * before main closes (FR-018, FR-039a).
 */
type Flusher = () => Promise<void>;

const flushers = new Set<Flusher>();

export function registerFlusher(fn: Flusher): () => void {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}

export async function flushAll(): Promise<void> {
  for (const fn of [...flushers]) await fn();
}
