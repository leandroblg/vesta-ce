// Files into the editors (FR-027 to FR-029, FR-027a): drop, paste, the menu's picker and typed paths go to main;
// refusals show as a notice. The renderer never sees a file path.
import type { AssetRef, AssetScope } from "../../shared/ipc-contract";
import { t } from "../i18n/t";
import { reportError } from "../report";
import { actions } from "../store/store";

const MAX_BYTES = 104_857_600;

function refused(code: string, name: string, scope: AssetScope): void {
  // 010 FR-002 (M1): a path inside Vesta's data folder is refused whatever the scope.
  if (code === "INSIDE_DATA") actions.showAssetNotice(t("fileInsideData", { n: name }));
  else if (code === "NOT_IMAGE" || scope === "title") actions.showAssetNotice(t("titleImagesOnly"));
  else if (code === "NOT_FOUND") actions.showAssetNotice(t("fileMissing", { n: name }));
  else actions.showAssetNotice(t("fileTooBig", { n: name }));
}

/** Imports dropped or pasted files; a file over 100 MB is refused before it is read. */
export async function importFiles(files: readonly File[], scope: AssetScope): Promise<AssetRef[]> {
  const refs: AssetRef[] = [];
  for (const file of files) {
    const name = (file.name === "" ? "file" : file.name).slice(0, 255);
    if (file.size > MAX_BYTES) {
      actions.showAssetNotice(t("fileTooBig", { n: name }));
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await window.vesta.assets.importBytes({ name, bytes, scope });
      if (result.ok) refs.push(result.value);
      else if (result.error.code === "TOO_LARGE" || result.error.code === "NOT_IMAGE")
        refused(result.error.code, name, scope);
      // 017 PRD Q269: a store refused while newer data is refused fails like any change (main logged it).
      else if (result.error.code === "SAVE_FAILED") actions.showSaveFailed();
      else reportError(`assets.import ${result.error.code}`, result.error.message);
    } catch (err) {
      reportError("assets.import", err);
    }
  }
  return refs;
}

/** The menu's "Insert file or image": the system file dialog in main. */
export async function pickFiles(scope: AssetScope): Promise<AssetRef[]> {
  try {
    const result = await window.vesta.assets.pick({ scope });
    if (!result.ok) {
      if (result.error.code === "SAVE_FAILED") actions.showSaveFailed();
      else reportError(`assets.pick ${result.error.code}`, result.error.message);
      return [];
    }
    for (const name of result.value.refused) refused("TOO_LARGE", name, scope);
    return result.value.refs;
  } catch (err) {
    reportError("assets.pick", err);
    return [];
  }
}

/** FR-027a: a `file:` URL or absolute path typed as a link. */
export async function importLinkPath(path: string, scope: AssetScope): Promise<AssetRef | null> {
  const name = path.split(/[\\/]/).pop() ?? path;
  try {
    const result = await window.vesta.assets.importPath({ path, scope });
    if (result.ok) return result.value;
    // 010 FR-001 (M1): the user declined the confirmation; nothing to say, the editor stays as it was.
    if (result.error.code === "CANCELLED") return null;
    refused(result.error.code, decodeURIComponent(name), scope);
  } catch (err) {
    reportError("assets.import-path", err);
  }
  return null;
}

/** The file options of an editor in `scope` (titles and reminders take images only). */
export function fileOptions(scope: "title" | "reminder" | "details") {
  const assetScope: AssetScope = scope === "details" ? "details" : "title";
  return {
    importFiles: (files: File[]) => importFiles(files, assetScope),
    pickFiles: () => pickFiles(assetScope),
    importPath: (path: string) => importLinkPath(path, assetScope),
  };
}
