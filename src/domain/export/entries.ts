/**
 * Zip entry names (008 research §3, FR-023, FR-024). An allow-list: anything not exactly `data.json`, a stored
 * file name or a plain path under `logs/` is "other", ignored and never written. Main never uses a name as a path.
 */
export type EntryKind =
  | { kind: "data" }
  | { kind: "asset"; sha256: string; ext: string }
  | { kind: "log" }
  | { kind: "other" };

const ASSET = /^assets\/([0-9a-f]{64})(?:\.([a-z0-9]{1,16}))?$/;

/** Path segments a safe log name may not hold: empty, `.` or `..`. */
function plainSegments(path: string): boolean {
  return path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

export function classifyEntry(name: string): EntryKind {
  if (name.includes("\\") || name.includes("\0")) return { kind: "other" };
  if (name === "data.json") return { kind: "data" };
  const asset = ASSET.exec(name);
  if (asset !== null) return { kind: "asset", sha256: asset[1] ?? "", ext: asset[2] ?? "" };
  if (name.startsWith("logs/") && plainSegments(name.slice("logs/".length))) return { kind: "log" };
  return { kind: "other" };
}
