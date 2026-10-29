/**
 * Whether Vesta runs on macOS, for the names of keys (011 US6, FR-031). Starts from the user agent and takes
 * main's answer once the initial state arrives (the store calls `setMac`). No store import, so the editor's
 * modules can read it.
 */
let mac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

export function isMacPlatform(): boolean {
  return mac;
}

export function setMac(value: boolean): void {
  mac = value;
}

/** 016 FR-016a: the platform for the file manager's name (Finder, File Explorer, the file manager). */
export function platformName(): "darwin" | "win32" | "linux" {
  if (mac) return "darwin";
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Windows") ? "win32" : "linux";
}
