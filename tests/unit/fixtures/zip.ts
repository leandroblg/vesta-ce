/** Test helpers: read a zip's entries with yauzl, and build arbitrary zips with yazl (008 tests). */
import { createWriteStream } from "node:fs";
import { crc32 } from "node:zlib";
import yauzl from "yauzl";
import yazl from "yazl";

export interface ZipEntryInfo {
  data: Buffer;
  compressed: boolean;
}

export function readZip(path: string): Promise<Map<string, ZipEntryInfo>> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err !== null) {
        reject(err);
        return;
      }
      const out = new Map<string, ZipEntryInfo>();
      zip.on("error", reject);
      zip.on("end", () => {
        resolve(out);
      });
      zip.on("entry", (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (e, stream) => {
          if (e !== null) {
            reject(e);
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            out.set(entry.fileName, { data: Buffer.concat(chunks), compressed: entry.compressionMethod !== 0 });
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

/** A zip with these entries, written by yazl (valid names only; see rawZip for hostile ones). */
export function writeZip(path: string, entries: Record<string, Buffer | string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const out = createWriteStream(path);
    out.on("close", () => {
      resolve();
    });
    out.on("error", reject);
    zip.outputStream.pipe(out);
    for (const [name, data] of Object.entries(entries)) {
      zip.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name);
    }
    zip.end();
  });
}

/**
 * A zip written byte by byte (stored entries, no validation), so tests can include names a real writer refuses,
 * such as `../evil` or `/etc/passwd`, and sizes that lie (FR-023, SC-003).
 */
export function rawZip(entries: { name: string; data: Buffer | string; declaredSize?: number }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const crc = zlibCrc32(data);
    const size = e.declaredSize ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function zlibCrc32(data: Buffer): number {
  return crc32(data) >>> 0;
}
