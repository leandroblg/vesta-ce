/** 017 FR-011 (research §3): a Windows .ico holding PNG images, written by hand (header, 16-byte entries, data). */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function writeIco(images: readonly { size: number; png: Buffer }[]): Buffer {
  for (const { size, png } of images) {
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`an .ico image cannot be ${String(size)} px`);
    if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`the ${String(size)} px image is not a PNG`);
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach(({ size, png }, i) => {
    const e = i * 16;
    // 0 stands for 256 in the one-byte width and height.
    entries.writeUInt8(size === 256 ? 0 : size, e);
    entries.writeUInt8(size === 256 ? 0 : size, e + 1);
    entries.writeUInt8(0, e + 2);
    entries.writeUInt8(0, e + 3);
    entries.writeUInt16LE(1, e + 4);
    entries.writeUInt16LE(32, e + 6);
    entries.writeUInt32LE(png.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, entries, ...images.map((i) => i.png)]);
}
