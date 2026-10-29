/** The file side of log rotation (009 research §2): list, append and delete in `<data>/logs`. */
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { parseFileName, type LogFileInfo } from "../../domain/logs/rotation";

export const logsDir = (dataDir: string): string => join(dataDir, "logs");

/** Vesta's log files only; a missing folder is an empty list. Other names are never touched. */
export function listLogFiles(dir: string): LogFileInfo[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return names.flatMap((name) => {
    const number = parseFileName(name);
    if (number === null) return [];
    try {
      return [{ name, number, size: statSync(join(dir, name)).size }];
    } catch {
      return [];
    }
  });
}

/** One synchronous write of the whole line, so no half-written entry is ever visible to a reader. */
export function appendLine(dir: string, name: string, line: string): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, name), line, { mode: 0o600 }); // 010 L9: owner-only
}

export function removeLogFile(dir: string, name: string): void {
  try {
    unlinkSync(join(dir, name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
