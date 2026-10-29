// Opening stored files and web links (005 FR-031; 010 FR-006, PRD Q129): a stored file opens with the default
// application only when its type is allow-listed (documents, images, audio, video); anything else, an executable
// type or a file with an execute bit is shown in the file manager. Web links open in the default browser or mail app.
import { statSync } from "node:fs";
import { isAssetRef, isExecutable, isOpenable } from "../../domain/markdown/assets";
import { DomainError } from "../../domain/task";
import { leadsOutside, storedFilePath } from "./path";
import { AssetError } from "./store";

/** The part of Electron's `shell` used here, injected so tests can stub it. */
export interface ShellLike {
  openPath: (path: string) => Promise<string>;
  showItemInFolder: (path: string) => void;
  openExternal: (url: string) => Promise<void>;
}

export interface OpenDeps {
  dir: string;
  shell: ShellLike;
  /** The asset row's existence (and extension), from the database. */
  find: (sha256: string) => { ext: string } | null;
  platform: NodeJS.Platform;
  /** 016 FR-016b: told when a stored file leads outside the stored-files folder. */
  warn?: (event: string) => void;
}

/** Returns how the file was opened. */
export function openAsset(ref: string, deps: OpenDeps): "opened" | "shown" {
  if (!isAssetRef(ref)) throw new AssetError("NOT_FOUND", `not a stored file: ${ref}`);
  // 008 research §9: the hash is the file's identity; the stored name (not the reference's) is what opens,
  // and it alone decides whether the file counts as executable.
  const sha256 = ref.slice("assets/".length, "assets/".length + 64);
  const row = deps.find(sha256);
  if (row === null) throw new AssetError("NOT_FOUND", `no stored file ${ref}`);
  const file = row.ext === "" ? sha256 : `${sha256}.${row.ext}`;
  const path = guardedPath(ref, file, deps);
  let mode: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error("not a file");
    mode = stat.mode;
  } catch {
    throw new AssetError("NOT_FOUND", `${ref} is missing`);
  }
  // macOS and Linux: an execute permission bit makes any file executable (FR-031); the 005 list stays as a second
  // barrier behind the 010 allow-list (M4).
  const executeBit = deps.platform !== "win32" && (mode & 0o111) !== 0;
  if (!isOpenable(file) || isExecutable(file) || executeBit) {
    deps.shell.showItemInFolder(path);
    return "shown";
  }
  void deps.shell.openPath(path);
  return "opened";
}

/** 016 FR-016b: the stored file's path inside `<data>/assets`; anything else is NOT_FOUND. */
function guardedPath(ref: string, file: string, deps: OpenDeps): string {
  const path = storedFilePath(deps.dir, file);
  if (path !== null) return path;
  if (leadsOutside(deps.dir, file)) deps.warn?.("asset.outside");
  throw new AssetError("NOT_FOUND", `${ref} is missing`);
}

/** 016 FR-016a (PRD Q241): Show in Finder, File Explorer or Folder: the stored copy, whatever its type, never opened. */
export function revealAsset(ref: string, deps: OpenDeps): void {
  if (!isAssetRef(ref)) throw new AssetError("NOT_FOUND", `not a stored file: ${ref}`);
  const sha256 = ref.slice("assets/".length, "assets/".length + 64);
  const row = deps.find(sha256);
  if (row === null) throw new AssetError("NOT_FOUND", `no stored file ${ref}`);
  deps.shell.showItemInFolder(guardedPath(ref, row.ext === "" ? sha256 : `${sha256}.${row.ext}`, deps));
}

const WEB = /^(?:https?:\/\/|mailto:)/i;

export function openExternal(url: string, shell: ShellLike): void {
  if (!WEB.test(url)) throw new DomainError("INVALID", `refused link: ${url}`);
  void shell.openExternal(url);
}
