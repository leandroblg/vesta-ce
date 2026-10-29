/**
 * 009 SC-005: which hosts a NetLog shows Vesta looking up or connecting to, from every process (research §13).
 * A request the session allow-list cancels never reaches the network stack, so it leaves no trace here;
 * blocked requests are proven by the `network.blocked` log entry instead (analysis M2).
 */
import { readFileSync } from "node:fs";

interface NetLog {
  constants: { logEventTypes: Record<string, number> };
  events: { type: number; params?: Record<string, unknown> }[];
}

/** Events that mean a DNS lookup or a socket connection was attempted. */
const CONNECTING = [
  "HOST_RESOLVER_MANAGER_REQUEST",
  "HOST_RESOLVER_MANAGER_JOB",
  "HOST_RESOLVER_DNS_TASK",
  "SOCKET_POOL_CONNECT_JOB_CREATED",
  "TCP_CLIENT_SOCKET_POOL_REQUESTED_SOCKET",
  "HTTP_STREAM_JOB",
];

/** "https://host:443", "ssl/host:443", "host:443" or "host" → "host". */
export function hostOf(value: string): string | null {
  const text = value.replace(/^(?:ssl|pm|socks\d?)\//i, "");
  try {
    if (text.includes("://")) return new URL(text).hostname;
  } catch {
    return null;
  }
  const m = /^\[?([^\]/]+?)\]?(?::\d+)?$/.exec(text);
  return m?.[1] ?? null;
}

export function connectedHosts(log: NetLog): string[] {
  const names = log.constants.logEventTypes;
  const wanted = new Set(CONNECTING.flatMap((n) => (names[n] === undefined ? [] : [names[n]])));
  const hosts = new Set<string>();
  for (const e of log.events) {
    if (!wanted.has(e.type)) continue;
    for (const key of ["host", "group_id", "destination"]) {
      const v = e.params?.[key];
      if (typeof v !== "string") continue;
      const h = hostOf(v);
      if (h !== null) hosts.add(h);
    }
  }
  return [...hosts].sort();
}

/** Reads a NetLog file; Chromium may leave the final `]}` off when the process exits abruptly. */
export function readNetLog(path: string): NetLog {
  const text = readFileSync(path, "utf8").trimEnd();
  try {
    return JSON.parse(text) as NetLog;
  } catch {
    return JSON.parse(`${text.replace(/,$/, "")}]}`) as NetLog;
  }
}

export const netLogHosts = (path: string): string[] => connectedHosts(readNetLog(path));
