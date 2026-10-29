import { describe, expect, it } from "vitest";
import { writeIco } from "../../../scripts/lib/ico.ts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A stand-in PNG: the signature plus `n` bytes, enough for the container's offsets. */
const png = (n: number) => Buffer.concat([PNG_SIGNATURE, Buffer.alloc(n, n % 251)]);
const SIZES = [16, 24, 32, 48, 64, 128, 256];

describe("ICO writer (017 FR-011, research §3)", () => {
  const ico = writeIco(SIZES.map((size) => ({ size, png: png(size) })));

  it("writes the header: reserved 0, type 1 (icon), 7 images", () => {
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(7);
  });

  it("points each 16-byte entry at its PNG, width and height 0 meaning 256", () => {
    SIZES.forEach((size, i) => {
      const e = 6 + i * 16;
      expect(ico.readUInt8(e), `width ${String(size)}`).toBe(size === 256 ? 0 : size);
      expect(ico.readUInt8(e + 1)).toBe(size === 256 ? 0 : size);
      expect(ico.readUInt16LE(e + 4)).toBe(1);
      expect(ico.readUInt16LE(e + 6)).toBe(32);
      const bytes = ico.readUInt32LE(e + 8);
      const offset = ico.readUInt32LE(e + 12);
      expect(bytes).toBe(png(size).length);
      expect(ico.subarray(offset, offset + 8).equals(PNG_SIGNATURE)).toBe(true);
    });
  });

  it("refuses a size it cannot store and an image that is not a PNG", () => {
    expect(() => writeIco([{ size: 512, png: png(1) }])).toThrow(/512/);
    expect(() => writeIco([{ size: 16, png: Buffer.from("nope") }])).toThrow(/PNG/);
  });
});
