import { describe, expect, it } from "vitest";
import { windowIcon } from "../../../src/main/window-prefs";

describe("017 FR-011a: the Linux window icon", () => {
  it("is the bundled PNG on a packaged Linux build", () => {
    expect(windowIcon({ platform: "linux", packaged: true, resourcesPath: "/r" })).toBe("/r/icon.png");
  });

  it("is left to the system on macOS and Windows, and in an unpackaged build", () => {
    expect(windowIcon({ platform: "darwin", packaged: true, resourcesPath: "/r" })).toBeUndefined();
    expect(windowIcon({ platform: "win32", packaged: true, resourcesPath: "/r" })).toBeUndefined();
    expect(windowIcon({ platform: "linux", packaged: false, resourcesPath: "/r" })).toBeUndefined();
  });
});
