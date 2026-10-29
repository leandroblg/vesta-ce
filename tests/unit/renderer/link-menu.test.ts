/** 016 FR-016, FR-016a, FR-016c (PRD Q234, Q241, Q255; ui.md "Link context menu"): what a right-click on a link offers. */
import { describe, expect, it } from "vitest";
import { linkMenuItems, revealLabel } from "../../../src/renderer/components/link-menu";

const ASSET = `assets/${"a".repeat(64)}.pdf`;

describe("016 the link context menu's items", () => {
  it("a web or mail link: Copy, Copy Link, Open Link", () => {
    expect(linkMenuItems("https://example.com")).toEqual(["copy", "copyLink", "open"]);
    expect(linkMenuItems("mailto:a@example.com")).toEqual(["copy", "copyLink", "open"]);
  });
  it("a stored file: also Show in Finder (File Explorer, Folder)", () => {
    expect(linkMenuItems(ASSET)).toEqual(["copy", "copyLink", "open", "reveal"]);
    expect(linkMenuItems(`vesta-asset://${ASSET}`)).toEqual(["copy", "copyLink", "open", "reveal"]);
  });
  it("a link whose address is not safe gets no menu", () => {
    expect(linkMenuItems("javascript:alert(1)")).toBeNull();
    expect(linkMenuItems("file:///etc/passwd")).toBeNull();
    expect(linkMenuItems("")).toBeNull();
  });
  it("Show in names the platform's file manager", () => {
    expect(revealLabel("darwin")).toBe("ctxRevealMac");
    expect(revealLabel("win32")).toBe("ctxRevealWin");
    expect(revealLabel("linux")).toBe("ctxRevealLinux");
  });
});
