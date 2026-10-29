/**
 * Privacy of log entries (009 FR-003, research §4): the user's home folder is written as `~` in every string,
 * and a network address is reduced to its scheme and host.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function homePattern(home: string): RegExp | null {
  if (home === "") return null;
  const trimmed = home.replace(/[\\/]+$/, "");
  const windows = trimmed.includes("\\");
  // The home only where a separator or the end of a path follows it, so /Users/an never matches /Users/ana.
  return new RegExp(`${escape(trimmed)}(?=[\\\\/]|$|[\\s"'):,;])`, windows ? "gi" : "g");
}

function redactValue(value: unknown, pattern: RegExp): unknown {
  if (typeof value === "string") return value.replace(pattern, "~");
  if (Array.isArray(value)) return value.map((v) => redactValue(v, pattern));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, pattern)]));
  }
  return value;
}

export function redact(fields: Readonly<Record<string, unknown>>, home: string): Record<string, unknown> {
  const pattern = homePattern(home);
  if (pattern === null) return { ...fields };
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, redactValue(v, pattern)]));
}

export function hostOnly(url: string): { scheme: string | null; host: string | null } {
  try {
    const u = new URL(url);
    return { scheme: u.protocol.replace(/:$/, ""), host: u.hostname };
  } catch {
    return { scheme: null, host: null };
  }
}
