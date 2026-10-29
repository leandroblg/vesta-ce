/**
 * Worker thread for the background fill (006 research §2): extracts searchable text off the main process,
 * so details of up to 1,000,000 characters never block IPC. Built as a second main-process entry.
 */
import { parentPort } from "node:worker_threads";
import { extractItem, type IndexItem } from "./extract";

interface Request {
  id: number;
  items: IndexItem[];
}

parentPort?.on("message", (req: Request) => {
  parentPort?.postMessage({ id: req.id, results: req.items.map(extractItem) });
});
