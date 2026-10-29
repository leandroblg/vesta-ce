// T011: an imported shortcut set on this OS (FR-033, research §5): remaps this OS refuses are dropped.
import { describe, expect, it } from "vitest";
import { sanitizeImportedOverrides } from "../../../../src/domain/shortcuts/sanitize";

describe("sanitizeImportedOverrides", () => {
  it("drops a remap that takes macOS's Minimize default, and keeps it elsewhere", () => {
    expect(sanitizeImportedOverrides({ newTask: ["Mod+M"] }, true)).toEqual({ kept: {}, dropped: ["newTask"] });
    expect(sanitizeImportedOverrides({ newTask: ["Mod+M"] }, false)).toEqual({ kept: { newTask: ["Mod+M"] }, dropped: [] });
  });

  it("drops a combination macOS reserves (Hide), and keeps it elsewhere", () => {
    expect(sanitizeImportedOverrides({ search: ["Mod+H"] }, true)).toEqual({ kept: {}, dropped: ["search"] });
    expect(sanitizeImportedOverrides({ search: ["Mod+H"] }, false)).toEqual({ kept: { search: ["Mod+H"] }, dropped: [] });
  });

  it("drops a remap that another action holds by default here", () => {
    expect(sanitizeImportedOverrides({ newSub: ["Mod+N"] }, false)).toEqual({ kept: {}, dropped: ["newSub"] });
  });

  it("keeps a valid remap unchanged and lists exactly the dropped ids", () => {
    const result = sanitizeImportedOverrides({ newTask: ["Mod+Alt+N"], newSub: ["Mod+H"], minimize: ["Mod+Shift+M"] }, true);
    expect(result).toEqual({ kept: { newTask: ["Mod+Alt+N"], minimize: ["Mod+Shift+M"] }, dropped: ["newSub"] });
  });

  it("keeps a remap onto a combination the same set frees (Minimize moved off Cmd+M)", () => {
    const result = sanitizeImportedOverrides({ newSub: ["Mod+M"], minimize: ["Mod+Shift+M"] }, true);
    expect(result).toEqual({ kept: { newSub: ["Mod+M"], minimize: ["Mod+Shift+M"] }, dropped: [] });
  });

  it("drops an action this version does not know", () => {
    expect(sanitizeImportedOverrides({ someFutureAction: ["Mod+K"] }, false)).toEqual({ kept: {}, dropped: ["someFutureAction"] });
  });

  it("returns an empty set for a value that is not a set", () => {
    expect(sanitizeImportedOverrides(null, false)).toEqual({ kept: {}, dropped: [] });
  });
});
