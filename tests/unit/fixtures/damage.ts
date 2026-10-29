/**
 * Damaged and foreign files for 008's SC-003 (tasks T054): each variant built from one valid export. Shared by
 * the reader's unit tests and the e2e refusal specs.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { toExportJson, type ExportData } from "../../../src/domain/export/format";
import { rawZip } from "./zip";

export const DAMAGE_VARIANTS = [
  "valid",
  "changedByte",
  "missingFile",
  "noDataJson",
  "truncatedDataJson",
  "newerVersion",
  "invalidField",
  "unrelatedZip",
  "notAZip",
  "sizeMismatch",
  "traversalEntry",
  "tooLargeFile",
] as const;
export type DamageVariant = (typeof DAMAGE_VARIANTS)[number];

const IMG = Buffer.from("a picture, byte for byte");
export const IMG_SHA = createHash("sha256").update(IMG).digest("hex");
export const IMG_PATH = `assets/${IMG_SHA}.png`;

function validData(): ExportData {
  return {
    appVersion: "0.8.0",
    exportedAt: 1_792_400_000_000,
    tasks: [
      {
        id: "00000000-0000-4000-8000-00000000d001",
        parentId: null,
        titleMd: "From the export",
        detailsMd: `![p](${IMG_PATH})`,
        position: 1,
        createdAt: 1_792_000_000_000,
        updatedAt: 1_792_000_000_000,
        doneAt: null,
        deletedAt: null,
        collapsed: false,
        prevSiblingId: null,
        nextSiblingId: null,
        leftWithId: null,
        keptDoneAt: null,
        alertOverrideMin: null,
        staleBaseAt: 1_792_000_000_000,
        staleSince: null,
        wasStale: false,
        lastBlinkAt: null,
        firstBlinkCount: null,
        manuallyPositioned: false,
        lastSignalAt: null,
        rescheduleForMin: null,
      },
    ],
    reminders: [],
    settings: [{ key: "theme", value: "dark", updatedAt: 1_792_000_000_000 }],
    assets: [{ sha256: IMG_SHA, ext: "png", mimeType: "image/png", size: IMG.length }],
  };
}

/** The variant's bytes, written to `path`. */
export function writeDamaged(path: string, variant: DamageVariant): void {
  const json = toExportJson(validData());
  const entries = (data: string, img: Buffer, more: { name: string; data: Buffer | string; declaredSize?: number }[] = []) =>
    rawZip([{ name: "data.json", data }, { name: IMG_PATH, data: img }, ...more]);
  const flipped = Buffer.from(IMG);
  flipped[3] = (flipped[3] ?? 0) ^ 0xff;
  switch (variant) {
    case "valid":
      writeFileSync(path, entries(json, IMG));
      return;
    case "changedByte":
      writeFileSync(path, entries(json, flipped));
      return;
    case "missingFile":
      writeFileSync(path, rawZip([{ name: "data.json", data: json }]));
      return;
    case "noDataJson":
      writeFileSync(path, rawZip([{ name: IMG_PATH, data: IMG }]));
      return;
    case "truncatedDataJson":
      writeFileSync(path, entries(json.slice(0, Math.floor(json.length / 2)), IMG));
      return;
    case "newerVersion":
      writeFileSync(path, entries(json.replace('"formatVersion":1', '"formatVersion":99'), IMG));
      return;
    case "invalidField":
      writeFileSync(path, entries(json.replace('"collapsed":false', '"collapsed":"no"'), IMG));
      return;
    case "unrelatedZip":
      writeFileSync(path, rawZip([{ name: "photo.jpg", data: "jpeg" }, { name: "readme.txt", data: "hi" }]));
      return;
    case "notAZip":
      writeFileSync(path, "This is a text file, not a zip.");
      return;
    case "sizeMismatch":
      writeFileSync(path, entries(json.replace(`"size":${String(IMG.length)}`, `"size":${String(IMG.length + 5)}`), IMG));
      return;
    case "traversalEntry":
      writeFileSync(path, entries(json, IMG, [{ name: "../evil.txt", data: "outside" }]));
      return;
    case "tooLargeFile":
      writeFileSync(path, entries(json.replace(`"size":${String(IMG.length)}`, '"size":104857601'), IMG));
      return;
  }
}

/** What each variant must give: null = accepted. */
export const EXPECTED_REFUSAL: Readonly<Record<DamageVariant, object | null>> = {
  valid: null,
  changedByte: { kind: "damaged", cause: "checksum", where: IMG_PATH },
  missingFile: { kind: "damaged", cause: "missingFile", where: IMG_PATH },
  noDataJson: { kind: "notVesta" },
  truncatedDataJson: { kind: "notVesta" },
  newerVersion: { kind: "newerVersion", version: 99 },
  invalidField: { kind: "damaged", cause: "invalidField", where: "tasks[0].collapsed" },
  unrelatedZip: { kind: "notVesta" },
  notAZip: { kind: "notVesta" },
  sizeMismatch: { kind: "damaged", cause: "sizeMismatch", where: IMG_PATH },
  traversalEntry: null,
  tooLargeFile: { kind: "damaged", cause: "tooLarge", where: IMG_PATH },
};
