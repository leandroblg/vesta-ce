import type { FormatSnapshot } from "../../domain/menu/state";

// The live editors, so the Edit menu's undo can reach the focused one without loading Milkdown (research §8).
export interface LiveEditor {
  /** 012 FR-009: which field it edits; the indent keys act only in the details. */
  readonly scope: "title" | "reminder" | "details";
  hasFocus(): boolean;
  /** Whether a node is inside the editor. */
  contains(node: Node): boolean;
  /** 013 T062: whether a node is inside the editor's own floating menu (or its picker and size grid). */
  menuContains?(node: Node): boolean;
  /** 012 FR-006, FR-007: list items one level deeper (1) or up (-1); false when nothing moves. */
  indent(dir: 1 | -1): boolean;
  /** Runs the editor's history undo; false when there is nothing to undo. */
  undo(): boolean;
  /** Runs the editor's history redo (007 research §10). */
  redo(): boolean;
  /** 013 research §4: runs a floating-menu option by id, as its button does (Shift for Outdent and the variants). */
  format?(id: string, shift?: boolean): boolean;
  /** 013 FR-016: what the floating menu offers, pressed and disabled now. */
  formatSnapshot?(): FormatSnapshot | null;
  /** 016 FR-017: the address of the one safe link the selection or cursor lies inside, or null (Copy Link). */
  linkAddress?(): string | null;
}

const live = new Set<LiveEditor>();

export function registerEditor(editor: LiveEditor): () => void {
  live.add(editor);
  return () => {
    live.delete(editor);
  };
}

let last: LiveEditor | null = null;

/** 013 T062: the editor a key's target belongs to: inside the editor itself or inside its own floating menu. */
export function editorFor(target: EventTarget | null): LiveEditor | null {
  if (!(target instanceof Node)) return null;
  for (const editor of live) if (editor.contains(target) || editor.menuContains?.(target) === true) return editor;
  return null;
}

/** The editor that has the keyboard focus, if any. */
export function activeEditor(): LiveEditor | null {
  for (const editor of live)
    if (editor.hasFocus()) {
      last = editor;
      return editor;
    }
  return null;
}

/**
 * 013 research §4: the editor a menu command acts on: the focused one or, while the focus is in no other page
 * element (a native menu on Windows and Linux may take it from the page), the last one that had it.
 */
export function menuEditor(): LiveEditor | null {
  const focused = activeEditor();
  if (focused !== null) return focused;
  if (last === null || !live.has(last)) return null;
  const el = document.activeElement;
  return el === null || el === document.body ? last : null;
}
