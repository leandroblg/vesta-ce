/**
 * The e2e hooks (004 research §8, 005 contracts/ipc.md): defined only when main says the build is unpackaged.
 * It imports nothing from the renderer, so its unit test runs under Node.
 */
export type TestEditorScope = "title" | "reminder" | "details";

export interface TestHooks {
  setMovingDisabled(on: boolean): void;
  /** Mounts a bare editor on the test layer (005 spike, T016); resolves to its index. */
  mountEditor(scope: TestEditorScope, md: string): Promise<number>;
  /** The stored text of a mounted editor. */
  editorMarkdown(index: number): string;
  /** The Enter and Esc keys a mounted title or reminder editor handed to its owner (saves and discards). */
  editorKeys(index: number): string[];
  /** Renders rows of markdown read-only on the test layer; returns the time taken in ms. */
  renderRows(mds: string[], scope: TestEditorScope): number;
  /** Makes the next editor load fail, for the plain-field fallback (FR-038, T063). */
  failEditorImport(): void;
  /** 011 FR-009: repaints every colored span on the page for `theme`; returns the time taken in ms. */
  paintAllMs(theme: "light" | "dark"): number;
  /** 018 SC-002: shows a notification of any kind, so a spec can measure its close button (an event of notifications.ts). */
  showNotice(event: unknown): void;
}

export function installTestHooks(
  state: { testHooks: boolean },
  target: { __vestaTest?: TestHooks },
  hooks: TestHooks,
): void {
  if (!state.testHooks) return;
  target.__vestaTest = Object.freeze({ ...hooks });
}
