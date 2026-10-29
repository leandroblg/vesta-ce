// Unpackaged builds only: the e2e hooks that mount editors and read-only rows on a test layer (005 T016).
import type { EditorHandle } from "./create-editor";
import type { TestEditorScope, TestHooks } from "../test-hooks";
import { applyRendered, renderMarkdown } from "../markdown/render";
import { ASSET_PROTOCOL } from "../../domain/markdown/policy";
import { failNextEditorImport } from "./load";

const editors: EditorHandle[] = [];
const keys: string[][] = [];

function layer(): HTMLElement {
  const existing = document.querySelector<HTMLElement>("[data-testid='test-layer']");
  if (existing) return existing;
  const el = document.createElement("div");
  el.className = "test-layer";
  el.dataset.testid = "test-layer";
  document.body.append(el);
  return el;
}

async function mountEditor(scope: TestEditorScope, md: string): Promise<number> {
  const { createEditor } = await import("./create-editor");
  const index = editors.length;
  const host = document.createElement("div");
  host.className = scope === "details" ? "md-host md-block md-editor" : "md-host md-title ed-title";
  host.dataset.testid = `test-editor-${String(index)}`;
  layer().append(host);
  keys[index] = [];
  const editor = await createEditor(host, {
    scope,
    value: md,
    label: `Test editor ${String(index)}`,
    resolveAsset: (ref) => ASSET_PROTOCOL + ref,
    onKey: (key) => {
      keys[index]?.push(key);
      return true;
    },
  });
  editor.markReady();
  editors.push(editor);
  return index;
}

function editorMarkdown(index: number): string {
  const editor = editors[index];
  if (!editor) throw new Error(`no test editor ${String(index)}`);
  return editor.getMarkdown();
}

function editorKeys(index: number): string[] {
  return [...(keys[index] ?? [])];
}

function renderRows(mds: string[], scope: TestEditorScope): number {
  const start = performance.now();
  const list = document.createElement("div");
  list.dataset.testid = "test-rows";
  for (const md of mds) {
    const row = document.createElement("div");
    row.className = scope === "details" ? "test-row md-block" : "test-row md-inline";
    row.innerHTML = renderMarkdown(md, scope).html;
    applyRendered(row);
    list.append(row);
  }
  layer().append(list);
  return performance.now() - start;
}

export function spikeHooks(setMovingDisabled: (on: boolean) => void): Omit<TestHooks, "paintAllMs" | "showNotice"> {
  return {
    setMovingDisabled,
    mountEditor,
    editorMarkdown,
    editorKeys,
    renderRows,
    failEditorImport: failNextEditorImport,
  };
}
