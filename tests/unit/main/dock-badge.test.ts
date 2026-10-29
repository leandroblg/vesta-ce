// 013 T047 (FR-024, PRD Q176): the macOS Dock badge follows the update mark.
import { describe, expect, it, vi } from "vitest";
import { applyDockBadge } from "../../../src/main/updates/dock-badge";

describe("013 FR-024 the Dock badge", () => {
  it('shows "1" with a mark and nothing without', () => {
    const dock = { setBadge: vi.fn() };
    applyDockBadge(dock, { mark: true });
    applyDockBadge(dock, { mark: false });
    expect(dock.setBadge.mock.calls).toEqual([["1"], [""]]);
  });

  it("does nothing where there is no Dock (Windows and Linux)", () => {
    expect(() => {
      applyDockBadge(undefined, { mark: true });
    }).not.toThrow();
  });
});
