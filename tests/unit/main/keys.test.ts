import { describe, expect, it, vi } from "vitest";
import { createCaptureForwarder, type InputLike } from "../../../src/main/keys";

const input = (over: Partial<InputLike> = {}): InputLike => ({
  type: "keyDown",
  key: "z",
  code: "KeyZ",
  alt: false,
  control: false,
  meta: true,
  shift: false,
  ...over,
});

describe("capture forwarding (007 research §11, contracts/ipc.md)", () => {
  it("forwards key-downs while on, stopping menus and the page", () => {
    const send = vi.fn();
    const f = createCaptureForwarder(send);
    f.setCapture(true);
    const preventDefault = vi.fn();
    f.onInput({ preventDefault }, input());
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ key: "z", code: "KeyZ", alt: false, control: false, meta: true, shift: false });
  });

  it("ignores key-ups and modifier-only presses", () => {
    const send = vi.fn();
    const f = createCaptureForwarder(send);
    f.setCapture(true);
    const preventDefault = vi.fn();
    f.onInput({ preventDefault }, input({ type: "keyUp" }));
    f.onInput({ preventDefault }, input({ key: "Meta", code: "MetaLeft" }));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does nothing while off, and turns off on blur or navigation", () => {
    const send = vi.fn();
    const f = createCaptureForwarder(send);
    const preventDefault = vi.fn();
    f.onInput({ preventDefault }, input());
    f.setCapture(true);
    f.onBlur();
    f.onInput({ preventDefault }, input());
    f.setCapture(true);
    f.onNavigation();
    f.onInput({ preventDefault }, input());
    expect(preventDefault).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
