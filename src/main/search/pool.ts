/**
 * The production extractor (006 research §2, §4): a pool of up to 4 worker threads. Each batch is split
 * across the workers, so the one-time fill after the update uses several cores and main stays free.
 * A crashed worker rejects its requests; the fill logs it and retries on its next kick.
 */
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { Extracted, Extractor, IndexItem } from "./extract";

interface Pending {
  resolve: (results: Extracted[]) => void;
  reject: (err: unknown) => void;
}

interface Slot {
  worker: Worker;
  pending: Map<number, Pending>;
}

export function poolSize(): number {
  return Math.max(1, Math.min(4, availableParallelism() - 1));
}

export function createWorkerPool(workerPath: string, size = poolSize()): { extract: Extractor; close: () => Promise<void> } {
  const slots: (Slot | null)[] = Array.from({ length: size }, () => null);
  let nextId = 0;

  function slot(i: number): Slot {
    const existing = slots[i];
    if (existing) return existing;
    const worker = new Worker(workerPath);
    const s: Slot = { worker, pending: new Map() };
    worker.on("message", (msg: { id: number; results: Extracted[] }) => {
      s.pending.get(msg.id)?.resolve(msg.results);
      s.pending.delete(msg.id);
    });
    const fail = (err: unknown) => {
      for (const p of s.pending.values()) p.reject(err);
      s.pending.clear();
      if (slots[i] === s) slots[i] = null;
    };
    worker.on("error", fail);
    worker.on("exit", (code) => {
      if (code !== 0) fail(new Error(`search worker exited with code ${String(code)}`));
      else if (slots[i] === s) slots[i] = null;
    });
    worker.unref();
    slots[i] = s;
    return s;
  }

  function run(i: number, items: IndexItem[]): Promise<Extracted[]> {
    const s = slot(i);
    const id = nextId++;
    return new Promise<Extracted[]>((resolve, reject) => {
      s.pending.set(id, { resolve, reject });
      s.worker.postMessage({ id, items });
    });
  }

  const extract: Extractor = async (items) => {
    const chunks: IndexItem[][] = Array.from({ length: Math.min(size, items.length) }, () => []);
    items.forEach((item, k) => chunks[k % chunks.length]?.push(item));
    const parts = await Promise.all(chunks.map((chunk, i) => run(i, chunk)));
    // Back to the input order (items were dealt round-robin).
    return items.map((_, k) => {
      const part = parts[k % parts.length] ?? [];
      const result = part[Math.floor(k / parts.length)];
      if (result === undefined) throw new Error("search worker returned too few results");
      return result;
    });
  };

  const close = async () => {
    await Promise.all(slots.flatMap((s) => (s === null ? [] : [s.worker.terminate()])));
  };

  return { extract, close };
}
