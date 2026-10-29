/**
 * Log viewer times (009 FR-016): local time as a fixed timestamp `YYYY-MM-DD HH:mm:ss.SSS`, the same in every
 * language, followed by that moment's UTC offset in hours: `-3`, `+2`, `+0`, `+5:30`. The caller passes the
 * offset in effect at the entry's own time, so entries on either side of a daylight-saving change differ.
 */

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `offsetMin`: minutes east of UTC (−180 for UTC−3), i.e. `-new Date(ms).getTimezoneOffset()`. */
export function formatLogTime(ms: number, offsetMin: number): string {
  const local = new Date(ms + offsetMin * 60_000);
  const date = `${String(local.getUTCFullYear())}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}.${pad(local.getUTCMilliseconds(), 3)}`;
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const minutes = abs % 60;
  const offset = `${sign}${String(Math.floor(abs / 60))}${minutes === 0 ? "" : `:${pad(minutes)}`}`;
  return `${date} ${time} ${offset}`;
}
