/**
 * The font size ladder of Increase and Decrease font size (012 FR-014 to FR-017, PRD Q156, B3): sizes relative to
 * the surrounding text, written in em; the default (1) is never written. A size off the ladder steps to the nearest
 * step strictly above or below it; a size in another unit counts as the default.
 */

export const SIZE_LADDER: readonly number[] = Object.freeze([0.75, 0.875, 1, 1.25, 1.5, 2, 2.5]);

const MIN = 0.75;
const MAX = 2.5;
const EPS = 1e-9;

/** The size as a multiple of the surrounding text; null and other units are the default. */
function valueOf(size: string | null): number {
  const m = size === null ? null : /^(\d+(?:\.\d+)?)em$/.exec(size);
  return m === null ? 1 : Number(m[1]);
}

const write = (v: number): string | null => (v === 1 ? null : `${String(v)}em`);

/** One step up (1) or down (-1) from `size`; null is the default size. */
export function stepSize(size: string | null, dir: 1 | -1): string | null {
  const cur = valueOf(size);
  if (dir === 1) return write(SIZE_LADDER.find((v) => v > cur + EPS) ?? MAX);
  return write([...SIZE_LADDER].reverse().find((v) => v < cur - EPS) ?? MIN);
}

/** Whether some part of the range can still step that way (FR-017). */
export function canStep(sizes: readonly (string | null)[], dir: 1 | -1): boolean {
  return sizes.some((s) => (dir === 1 ? valueOf(s) < MAX - EPS : valueOf(s) > MIN + EPS));
}
