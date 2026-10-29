/** The export file name (008 FR-010): `vesta-export-YYYY-MM-DD.zip`, then `-2`, `-3`, … never overwriting. */

export function exportFileName(localDate: string, taken: ReadonlySet<string>): string {
  const base = `vesta-export-${localDate}`;
  if (!taken.has(`${base}.zip`)) return `${base}.zip`;
  for (let n = 2; ; n++) {
    const name = `${base}-${String(n)}.zip`;
    if (!taken.has(name)) return name;
  }
}

/**
 * The local calendar date of `now` (UTC ms), given the offset `Date.prototype.getTimezoneOffset` reports for it
 * (minutes, positive west of UTC). Main passes both, so this stays pure.
 */
export function localDate(now: number, timezoneOffsetMin: number): string {
  const d = new Date(now - timezoneOffsetMin * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
