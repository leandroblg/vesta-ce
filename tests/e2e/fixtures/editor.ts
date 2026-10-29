/** Editor input for the 005 specs (quickstart.md "Test controls"). */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

/** Types into an editor as keystrokes, so input rules run. */
export async function typeIn(editor: Locator, text: string): Promise<void> {
  await editor.focus();
  await editor.page().keyboard.type(text);
}

/** Selects the first occurrence of `text` inside the editor, through the DOM selection ProseMirror follows. */
export async function selectText(editor: Locator, text: string): Promise<void> {
  await editor.evaluate((root: HTMLElement, wanted) => {
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(wanted) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      // ProseMirror learns of a DOM selection through the browser's queued `selectionchange`; its focus handler
      // meanwhile writes the editor's previous selection back into the DOM after 20 ms when the two differ. Telling
      // it now closes that window, which under full-suite load put a mark on the word selected before.
      document.dispatchEvent(new Event("selectionchange"));
      if (selection?.toString() !== wanted) throw new Error(`selection lost: ${wanted}`);
      return;
    }
    throw new Error(`text not found: ${wanted}`);
  }, text);
}

/** Puts the caret at the end of the editor. */
export async function caretAtEnd(editor: Locator): Promise<void> {
  await editor.evaluate((root: HTMLElement) => {
    root.focus();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

/** The floating formatting menu (FR-023). */
export function menu(page: Page): Locator {
  return page.getByRole("toolbar", { name: "Formatting" });
}

type FilePayload = { name: string; type: string; base64: string };

const payload = (path: string, type = "application/octet-stream"): FilePayload => ({
  name: basename(path),
  type,
  base64: readFileSync(path).toString("base64"),
});

/** Drops a file on `target` as the operating system would (a `drop` with a File). */
export async function dropFile(target: Locator, path: string, type?: string): Promise<void> {
  await target.evaluate(
    (el, file: FilePayload) => {
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], file.name, { type: file.type }));
      // Dropped at the end of the editor's content, after what is already there.
      const box = el.getBoundingClientRect();
      const at = {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        clientX: box.right - 4,
        clientY: box.bottom - 4,
      };
      el.dispatchEvent(new DragEvent("dragenter", at));
      el.dispatchEvent(new DragEvent("dragover", at));
      el.dispatchEvent(new DragEvent("drop", at));
    },
    payload(path, type),
  );
}

/** Pastes rich text (HTML, with its plain-text form). */
export async function pasteHtml(target: Locator, html: string, text = ""): Promise<void> {
  await target.evaluate(
    (el, [h, p]) => {
      const data = new DataTransfer();
      data.setData("text/html", h);
      data.setData("text/plain", p);
      el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    },
    [html, text] as const,
  );
}

/** Pastes an image file, as a screenshot pasted from the clipboard. */
export async function pasteImage(target: Locator, path: string, type = "image/png"): Promise<void> {
  await target.evaluate(
    (el, file: FilePayload) => {
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], file.name, { type: file.type }));
      el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    },
    payload(path, type),
  );
}

/** Pastes plain text, as the clipboard plugin receives a markdown copy. */
export async function pasteText(target: Locator, text: string): Promise<void> {
  await target.evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, text);
}

/** Drops a file of `size` bytes made in the page (a large file without writing or sending its content). */
export async function dropLargeFile(target: Locator, name: string, size: number, type = ""): Promise<void> {
  await target.evaluate(
    (el, [n, bytes, t]) => {
      const data = new DataTransfer();
      data.items.add(new File([new ArrayBuffer(bytes)], n, { type: t }));
      const box = el.getBoundingClientRect();
      const at = {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        clientX: box.right - 4,
        clientY: box.bottom - 4,
      };
      el.dispatchEvent(new DragEvent("dragenter", at));
      el.dispatchEvent(new DragEvent("dragover", at));
      el.dispatchEvent(new DragEvent("drop", at));
    },
    [name, size, type] as const,
  );
}

/** 011: the color picker that Text color and (013 FR-042) a long press or Shift+Enter on Highlight open. */
export const colorPicker = (page: Page) => page.locator(".cpick:not([hidden])");

/** 013 FR-042: the highlight picker, from the one Highlight button with Shift+Enter (a long press does the same). */
export async function openHighlightPicker(page: Page): Promise<void> {
  await menu(page).getByRole("button", { name: "Highlight", exact: true }).focus();
  await page.keyboard.press("Shift+Enter");
  await expect(colorPicker(page)).toBeVisible();
}

/** 016 FR-021: a click on Text color applies its swatch; Shift+Enter (or a hold) opens the text color picker. */
export async function openTextColorPicker(page: Page): Promise<void> {
  await menu(page).getByRole("button", { name: "Text color", exact: true }).focus();
  await page.keyboard.press("Shift+Enter");
  await expect(colorPicker(page)).toBeVisible();
}

/** Opens the picker from the menu and confirms `hex` in its system selector (set and changed, as Playwright cannot drive the native one). */
export async function pickCustomColor(page: Page, which: "Text color" | "Highlight color", hex: string): Promise<void> {
  if (which === "Highlight color") await openHighlightPicker(page);
  else await openTextColorPicker(page);
  await colorPicker(page).locator("input[type='color']").evaluate((input: HTMLInputElement, value) => {
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, hex);
}
