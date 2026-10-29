/**
 * Shortcut capture forwarding (007 research §11): while the renderer captures a shortcut, every key-down is
 * stopped before Electron's menu sees it and sent to the renderer instead, so a menu-owned combination
 * (Mod+Q) is shown as refused rather than acted on. Off on window blur and on navigation.
 */
import type { CapturedKey } from "../shared/ipc-contract";

export interface InputLike {
  type: string;
  key: string;
  code: string;
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
}

const MODIFIERS = new Set(["Meta", "Control", "Shift", "Alt", "AltGraph", "OS", "CapsLock", "Fn"]);

export function createCaptureForwarder(send: (key: CapturedKey) => void) {
  let on = false;
  return {
    setCapture(next: boolean): void {
      on = next;
    },
    /** For `webContents.on("before-input-event", …)`. */
    onInput(event: { preventDefault: () => void }, input: InputLike): void {
      if (!on || input.type !== "keyDown" || MODIFIERS.has(input.key)) return;
      event.preventDefault();
      send({ key: input.key, code: input.code, alt: input.alt, control: input.control, meta: input.meta, shift: input.shift });
    },
    onBlur(): void {
      on = false;
    },
    onNavigation(): void {
      on = false;
    },
  };
}
