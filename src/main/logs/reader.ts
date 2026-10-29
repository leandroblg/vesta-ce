/**
 * The log viewer's reader (009 FR-014, FR-019, research §6). It reads the files backwards from the newest end,
 * newest entry first (PRD Q127), in chunks, across files in their circular order, and returns pages of at most
 * 400 lines at the selected level and every more important one. One call scans at most a few MiB, so a rare
 * level never holds main for a full 50 MiB read; the cursor always points at a line boundary.
 */
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseLine } from "../../domain/logs/entry";
import { shows, type LogLevel } from "../../domain/logs/levels";
import { orderFiles } from "../../domain/logs/rotation";
import type { LogCursor, LogLine, LogPage } from "../../shared/ipc-contract";
import { listLogFiles } from "./files";

export interface ReadOptions {
  /** Bytes read per step (256 KiB). */
  chunkBytes?: number;
  /** Bytes scanned per call at most (4 MiB). */
  scanBytes?: number;
  /** Lines per page at most (400). */
  pageLines?: number;
}

const NEWLINE = 0x0a;

export function toLogLine(text: string): LogLine {
  const parsed = parseLine(text);
  if (parsed.kind === "raw") return { time: null, level: null, event: null, fields: {}, raw: text, cut: false };
  const { time, level, event, fields, cut } = parsed.entry;
  return { time, level, event, fields, raw: null, cut };
}

const empty = (over: Partial<LogPage> = {}): LogPage => ({ lines: [], older: null, removedOlder: false, unreadable: false, ...over });

export async function readLogPage(dir: string, cursor: LogCursor | null, level: LogLevel, options: ReadOptions = {}): Promise<LogPage> {
  const scanBytes = options.scanBytes ?? 4 * 1024 * 1024;
  const chunkBytes = Math.min(options.chunkBytes ?? 256 * 1024, scanBytes);
  const pageLines = options.pageLines ?? 400;

  let files;
  try {
    files = listLogFiles(dir);
  } catch {
    return empty({ unreadable: true });
  }
  const newestFirst = orderFiles(files.map((f) => f.number))
    .reverse()
    .map((n) => files.find((f) => f.number === n))
    .filter((f) => f !== undefined);
  if (newestFirst.length === 0) return empty();

  let index: number;
  let end: number;
  if (cursor === null) {
    index = 0;
    end = newestFirst[0]?.size ?? 0;
  } else {
    index = newestFirst.findIndex((f) => f.name === cursor.file);
    if (index === -1) return empty({ removedOlder: true });
    end = cursor.offset;
  }

  const lines: LogLine[] = [];
  let scanned = 0;
  for (;;) {
    const file = newestFirst[index];
    if (file === undefined) return { lines, older: null, removedOlder: false, unreadable: false };
    let handle;
    try {
      handle = await open(join(dir, file.name), "r");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { lines, older: null, removedOlder: true, unreadable: false };
      return { lines, older: null, removedOlder: false, unreadable: lines.length === 0 };
    }
    try {
      end = Math.min(end, (await stat(join(dir, file.name))).size);
      // `carry`: the start of a line that began before the bytes read so far (no newline seen yet).
      let carry = Buffer.alloc(0);
      while (end > 0 || carry.length > 0) {
        const start = Math.max(0, end - chunkBytes);
        const chunk = Buffer.alloc(end - start);
        if (chunk.length > 0) await handle.read(chunk, 0, chunk.length, start);
        scanned += chunk.length;
        const buf = carry.length === 0 ? chunk : Buffer.concat([chunk, carry]);
        // Lines are the segments between newlines; the first one is partial unless the read reached the file start.
        let lineEnd = buf.length;
        if (buf[lineEnd - 1] === NEWLINE) lineEnd -= 1;
        let pos = lineEnd;
        while (pos > 0) {
          const nl = buf.lastIndexOf(NEWLINE, pos - 1);
          if (nl === -1 && start > 0) break; // partial: keep it for the next chunk
          const lineStart = nl + 1;
          const text = buf.subarray(lineStart, lineEnd).toString("utf8");
          if (text !== "") {
            const l = toLogLine(text);
            if (l.level === null || shows(l.level, level)) lines.push(l);
          }
          lineEnd = nl;
          pos = nl;
          if (lines.length >= pageLines) {
            const boundary = start + lineStart;
            return { lines, older: boundary > 0 ? { file: file.name, offset: boundary } : olderFile(newestFirst, index), removedOlder: false, unreadable: false };
          }
          if (nl === -1) break;
        }
        carry = start > 0 ? Buffer.from(buf.subarray(0, Math.max(0, pos))) : Buffer.alloc(0);
        end = start;
        if (start === 0) break;
        if (scanned >= scanBytes) {
          const boundary = start + carry.length;
          return { lines, older: { file: file.name, offset: boundary }, removedOlder: false, unreadable: false };
        }
      }
    } finally {
      await handle.close();
    }
    index += 1;
    const older = newestFirst[index];
    if (older === undefined) return { lines, older: null, removedOlder: false, unreadable: false };
    end = older.size;
    if (scanned >= scanBytes) return { lines, older: { file: older.name, offset: older.size }, removedOlder: false, unreadable: false };
  }
}

function olderFile(files: readonly { name: string; size: number }[], index: number): LogCursor | null {
  const older = files[index + 1];
  return older === undefined ? null : { file: older.name, offset: older.size };
}
