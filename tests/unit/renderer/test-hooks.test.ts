import { describe, expect, it, vi } from "vitest";
import { installTestHooks, type TestHooks } from "../../../src/renderer/test-hooks";

const hooks = (setMovingDisabled = vi.fn()): TestHooks => ({
  setMovingDisabled,
  mountEditor: vi.fn(() => Promise.resolve(0)),
  editorMarkdown: vi.fn(() => ""),
  editorKeys: vi.fn(() => []),
  renderRows: vi.fn(() => 0),
  failEditorImport: vi.fn(),
  paintAllMs: vi.fn(() => 0),
  showNotice: vi.fn(),
});

describe("installTestHooks (004 research §8)", () => {
  it("defines nothing when testHooks is false (packaged builds)", () => {
    const target: { __vestaTest?: TestHooks } = {};
    installTestHooks({ testHooks: false }, target, hooks());
    expect("__vestaTest" in target).toBe(false);
  });

  it("defines a frozen setMovingDisabled that calls the store's switch when testHooks is true", () => {
    const target: { __vestaTest?: TestHooks } = {};
    const set = vi.fn();
    installTestHooks({ testHooks: true }, target, hooks(set));
    target.__vestaTest?.setMovingDisabled(true);
    expect(set).toHaveBeenCalledWith(true);
    expect(Object.isFrozen(target.__vestaTest)).toBe(true);
  });

  it("defines the 005 spike hooks only in unpackaged builds", () => {
    const packaged: { __vestaTest?: TestHooks } = {};
    installTestHooks({ testHooks: false }, packaged, hooks());
    expect(packaged.__vestaTest).toBeUndefined();
    const unpackaged: { __vestaTest?: TestHooks } = {};
    installTestHooks({ testHooks: true }, unpackaged, hooks());
    expect(Object.keys(unpackaged.__vestaTest ?? {}).sort()).toEqual([
      "editorKeys",
      "editorMarkdown",
      "failEditorImport",
      "mountEditor",
      "paintAllMs",
      "renderRows",
      "setMovingDisabled",
      "showNotice",
    ]);
  });
});
