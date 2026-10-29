// Stored files (FR-027 to FR-033): references in markdown, image sniffing, executable types.
import { parseMarkdown, walk } from "./parse";

const ASSET_REF = /^assets\/[0-9a-f]{64}(?:\.[a-z0-9]{1,16})?$/;
const HTML_ASSET = /\b(?:src|href)\s*=\s*["']?(assets\/[0-9a-f]{64}(?:\.[a-z0-9]{1,16})?)(?=["'\s>]|$)/gi;

/** `assets/<64 lowercase hex>[.<ext>]`, exactly as markdown and `backup_assets.path` store it. */
export function isAssetRef(value: string): boolean {
  return ASSET_REF.test(value);
}

/** Every stored file referenced by image and link targets (and inline HTML), deduped, in document order. */
export function assetRefs(md: string): string[] {
  if (!md.includes("assets/")) return [];
  const found = new Set<string>();
  walk(parseMarkdown(md), (node) => {
    if ((node.type === "image" || node.type === "link" || node.type === "definition") && isAssetRef(node.url)) {
      found.add(node.url);
    } else if (node.type === "html") {
      for (const match of node.value.matchAll(HTML_ASSET)) {
        const ref = match[1];
        if (ref !== undefined && isAssetRef(ref)) found.add(ref);
      }
    }
  });
  return [...found];
}

/** The stored extension: lowercased, `[a-z0-9]` only; `''` when nothing is left or it exceeds 16 characters. */
export function storedExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  const ext = name
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return ext.length > 16 ? "" : ext;
}

export type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean =>
  bytes.length >= at + signature.length && signature.every((b, i) => bytes[at + i] === b);

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

/** The image type from the first bytes (PNG, JPEG, GIF, WebP), or null; SVG is a file, not an image (FR-027). */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

/** 010 FR-004 (M2): the type Vesta stores and serves, from the bytes first, then the extension, never from an import. */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  // Images are normally sniffed from their bytes; the extension decides only when no bytes are at hand.
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  svg: "image/svg+xml",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function assetMimeType(firstBytes: Uint8Array, ext: string): string {
  return sniffImage(firstBytes) ?? MIME_BY_EXT[ext.toLowerCase()] ?? "application/octet-stream";
}

/**
 * 010 FR-006 (M4, PRD Q129): the document, image, audio and video types that open with the default application.
 * Everything else is shown in the file manager. A product value: shorten freely, extend only by a PRD decision.
 */
export const OPENABLE: ReadonlySet<string> = new Set([
  ...["png", "jpg", "jpeg", "gif", "webp"],
  ...["pdf", "txt", "md", "csv", "json"],
  ...["mp3", "wav", "mp4", "mov"],
  ...["docx", "xlsx", "pptx"],
]);

/** True for an allow-listed extension (any case); a name without extension is never openable. */
export function isOpenable(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && OPENABLE.has(name.slice(dot + 1).toLowerCase());
}

// FR-031: Windows, macOS and Linux executable types. Kept as a second barrier behind the allow-list (010 FR-006).
const EXECUTABLE = new Set([
  ...["exe", "bat", "cmd", "com", "msi", "ps1", "vbs", "js", "scr", "lnk"],
  ...["app", "command", "pkg", "tool", "sh"],
  ...["run", "bin", "appimage", "desktop"],
]);

/** True for the FR-031 executable extensions (any case). The execute permission bit is checked in main. */
export function isExecutable(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && EXECUTABLE.has(name.slice(dot + 1).toLowerCase());
}
