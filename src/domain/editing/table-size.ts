/** The Table option's sizes (011 FR-018 to FR-020a). Rows count the header row. Pure TypeScript. */
import { GRID_MAX, GRID_MIN, MAX_TABLE_SIZE } from "../limits";

export const DEFAULT_TABLE = Object.freeze({ cols: 3, rows: 3 });

/** The grid always shows one column and one row beyond the highlighted cell, from 8 × 8 up to 20 × 20 (FR-019). */
export function gridSize(highlightedCols: number, highlightedRows: number): { cols: number; rows: number } {
  const size = (h: number) => Math.min(GRID_MAX, Math.max(GRID_MIN, h + 1));
  return { cols: size(highlightedCols), rows: size(highlightedRows) };
}

/** A typed size: a whole number from 1 to 100, or null (FR-020a). */
export function parseSize(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_TABLE_SIZE ? n : null;
}
