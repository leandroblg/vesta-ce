/**
 * Release versions (009 FR-023, research §7): `major.minor.patch` with an optional `v`, compared numerically.
 * 017 (FR-003a, FR-004, PRD Q260): an optional `-beta.N` tag; a release is newer than any beta of the same number,
 * and betas of one number compare by N. No other pre-release tag is read, so file names stay unambiguous.
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** N of `-beta.N`; null for a release. */
  beta: number | null;
}

const VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/;

export function parseVersion(text: string): Version | null {
  const m = VERSION.exec(text);
  if (m === null) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), beta: m[4] === undefined ? null : Number(m[4]) };
}

export function compareVersions(a: Version, b: Version): number {
  const base = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (base !== 0) return base;
  if (a.beta === b.beta) return 0;
  if (a.beta === null) return 1;
  if (b.beta === null) return -1;
  return a.beta - b.beta;
}

export const formatVersion = (v: Version): string =>
  `${String(v.major)}.${String(v.minor)}.${String(v.patch)}${v.beta === null ? "" : `-beta.${String(v.beta)}`}`;

/** A readable version with a `-beta.N` tag (the beta build refuses anything else, FR-004). */
export function isBeta(text: string): boolean {
  return parseVersion(text)?.beta != null;
}
