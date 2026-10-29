/**
 * One log line (009 research §3, contracts/log-format.md): a JSON object with time, level and event first,
 * then flat fields, in UTF-8, at most 1 MiB including the newline. A longer line has its largest fields cut
 * and carries `"cut": true`.
 */
import { isLogLevel, type LogLevel } from "./levels";
import { LOG_FILE_MAX } from "./rotation";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface EntryInput {
  time: number;
  level: LogLevel;
  event: string;
  fields: Record<string, unknown>;
}

export interface LogEntry {
  /** Epoch ms, or null when the stored time cannot be read. */
  time: number | null;
  level: LogLevel;
  event: string;
  fields: Record<string, unknown>;
  cut: boolean;
}

export type ParsedLine = { kind: "entry"; entry: LogEntry } | { kind: "raw"; text: string };

const RESERVED = new Set(["time", "level", "event", "cut"]);
const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

function serialize(head: Record<string, unknown>, fields: Record<string, unknown>): string {
  return `${JSON.stringify({ ...head, ...fields })}\n`;
}

/** Halves a string without splitting a surrogate pair. */
function halve(s: string): string {
  let end = Math.floor(s.length / 2);
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return s.slice(0, Math.max(0, end));
}

export function formatEntry({ time, level, event, fields }: EntryInput): string {
  const head: Record<string, unknown> = { time: new Date(time).toISOString(), level, event };
  const own: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (!RESERVED.has(k) && v !== undefined) own[k] = v;
  let line = serialize(head, own);
  if (byteLength(line) <= LOG_FILE_MAX) return line;

  head["cut"] = true;
  for (;;) {
    line = serialize(head, own);
    if (byteLength(line) <= LOG_FILE_MAX) return line;
    // The largest field gives way first: a string is halved, anything else is replaced by a mark.
    let largest: string | null = null;
    let size = -1;
    for (const [k, v] of Object.entries(own)) {
      const n = JSON.stringify(v).length;
      if (n > size) {
        size = n;
        largest = k;
      }
    }
    if (largest === null) return serialize({ ...head, event: halve(event) }, {});
    const key = largest;
    const v = own[key];
    const next = typeof v === "string" && v.length > 1 ? halve(v) : "[cut]";
    // A value already reduced to the mark goes entirely, so the loop always shrinks the line.
    if (next === v) Reflect.deleteProperty(own, key);
    else own[key] = next;
  }
}

export function parseLine(text: string): ParsedLine {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: "raw", text };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { kind: "raw", text };
  const o = value as Record<string, unknown>;
  const level = o["level"];
  if (!isLogLevel(level)) return { kind: "raw", text };
  const parsedTime = typeof o["time"] === "string" ? Date.parse(o["time"]) : Number.NaN;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!RESERVED.has(k)) fields[k] = v;
  return {
    kind: "entry",
    entry: {
      time: Number.isFinite(parsedTime) ? parsedTime : null,
      level,
      event: typeof o["event"] === "string" ? o["event"] : "",
      fields,
      cut: o["cut"] === true,
    },
  };
}
