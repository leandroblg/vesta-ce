// Loads the live editor (Milkdown) on demand. Unpackaged builds can make the next load fail, to test the
// plain-text fallback (FR-038, T063).
let failNext = false;

export function failNextEditorImport(): void {
  failNext = true;
}

export async function loadEditor(): Promise<typeof import("./create-editor")> {
  if (failNext) {
    failNext = false;
    throw new Error("editor import failed (test hook)");
  }
  return import("./create-editor");
}
