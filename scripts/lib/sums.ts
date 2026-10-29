/** 017 FR-007, FR-020: the handout's SHA256SUMS, in the `<hash>  <name>` form `sha256sum -c` and `shasum -a 256 -c` read. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const SUMS_FILE = "SHA256SUMS";

export interface SumEntry {
  name: string;
  hash: string;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** One line per file, lowercase hex, sorted by name (data-model "Handout set"). */
export function formatSums(entries: readonly SumEntry[]): string {
  for (const e of entries) if (!/^[0-9a-f]{64}$/i.test(e.hash)) throw new Error(`not a SHA-256 hash for ${e.name}`);
  return [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => `${e.hash.toLowerCase()}  ${e.name}\n`)
    .join("");
}

export function parseSums(text: string): SumEntry[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
      if (m === null) throw new Error(`unreadable SHA256SUMS line: ${line}`);
      return { hash: m[1] ?? "", name: m[2] ?? "" };
    });
}

/** Compares a folder with its SHA256SUMS: files without a line, lines without a file, and wrong hashes. */
export async function checkSums(dir: string): Promise<{ missing: string[]; extra: string[]; mismatched: string[] }> {
  const listed = parseSums(await readFile(join(dir, SUMS_FILE), "utf8"));
  const present = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile() && d.name !== SUMS_FILE).map((d) => d.name);
  const listedNames = new Set(listed.map((e) => e.name));
  const missing = listed.filter((e) => !present.includes(e.name)).map((e) => e.name);
  const extra = present.filter((name) => !listedNames.has(name)).sort();
  const mismatched: string[] = [];
  for (const e of listed) if (present.includes(e.name) && (await sha256File(join(dir, e.name))) !== e.hash) mismatched.push(e.name);
  return { missing, extra, mismatched };
}

/** The hashes of the named files in `dir`, ready for formatSums. */
export async function hashFiles(dir: string, names: readonly string[]): Promise<SumEntry[]> {
  const out: SumEntry[] = [];
  for (const name of names) out.push({ name, hash: await sha256File(join(dir, name)) });
  return out;
}
