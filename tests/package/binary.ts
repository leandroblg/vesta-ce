/** 017 FR-016, FR-019 (research §9): what a binary is built for, read from its header. */

/** ELF, 64-bit, little-endian, x86-64. */
export function isElfX64(b: Buffer): boolean {
  return b.length > 0x14 && b.readUInt32BE(0) === 0x7f454c46 && b[4] === 2 && b[5] === 1 && b.readUInt16LE(0x12) === 0x3e;
}

/** A PE32+ (64-bit) image for x86-64: `MZ`, then `PE\0\0`, machine 0x8664, optional-header magic 0x20B. */
export function isPe32PlusX64(b: Buffer): boolean {
  if (b.length < 0x40 || b.toString("latin1", 0, 2) !== "MZ") return false;
  const pe = b.readUInt32LE(0x3c);
  if (b.length < pe + 26 || b.readUInt32BE(pe) !== 0x50450000) return false;
  return b.readUInt16LE(pe + 4) === 0x8664 && b.readUInt16LE(pe + 24) === 0x20b;
}

/**
 * A Nullsoft (NSIS) self-extractor: a 32-bit x86 PE32 stub (machine 0x14C, magic 0x10B) that runs on x64 Windows and
 * unpacks the x64 app (the portable .exe).
 */
export function isNsisStub(b: Buffer): boolean {
  if (b.length < 0x40 || b.toString("latin1", 0, 2) !== "MZ") return false;
  const pe = b.readUInt32LE(0x3c);
  const pe32 = b.readUInt32BE(pe) === 0x50450000 && b.readUInt16LE(pe + 4) === 0x14c && b.readUInt16LE(pe + 24) === 0x10b;
  return pe32 && b.includes("NullsoftInst", 0, "latin1");
}

/** An AppImage: an ELF x86-64 runtime followed by a SquashFS image (`hsqs`). */
export function isAppImageX64(b: Buffer): boolean {
  return isElfX64(b) && b.indexOf("hsqs", 0x40, "latin1") > 0;
}
