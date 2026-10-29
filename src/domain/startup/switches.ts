/**
 * Command-line switches a packaged build refuses to start with (010 FR-022, audit L12, research §8).
 * Pure: main calls `refusedSwitches` first thing and exits before `ready` when the list is not empty.
 */
export const DENIED_SWITCHES = [
  "remote-debugging-port",
  "remote-debugging-pipe",
  "remote-allow-origins",
  "inspect",
  "inspect-brk",
  "inspect-port",
  "proxy-server",
  "proxy-pac-url",
  "proxy-bypass-list",
  "ignore-certificate-errors",
  "ignore-certificate-errors-spki-list",
  "disable-web-security",
  "no-sandbox",
  "js-flags",
  "host-rules",
  "host-resolver-rules",
  "allow-running-insecure-content",
] as const;

/** Where the app runs: 017's Linux sandbox exception depends on it (FR-006a, PRD Q265). */
export interface SwitchContext {
  /** `process.platform`. */
  platform: string;
  packaged: boolean;
  /** The `unshare -Ur true` probe failed: the system blocks unprivileged user namespaces. */
  sandboxBlocked: boolean;
}

/**
 * Constitution v1.2.0 principle II: a packaged Linux build may run without Chromium's sandbox, and only where the
 * system blocks the user namespaces it needs (Ubuntu 24.04 and later by default).
 */
const sandboxExempt = (ctx: SwitchContext | undefined): boolean => ctx !== undefined && ctx.platform === "linux" && ctx.packaged && ctx.sandboxBlocked;

/** The denied switches present, through Chromium's parsed command line or the raw arguments, in list order. */
export function refusedSwitches(hasSwitch: (name: string) => boolean, argv: readonly string[], ctx?: SwitchContext): string[] {
  return DENIED_SWITCHES.filter(
    (name) =>
      !(name === "no-sandbox" && sandboxExempt(ctx)) && (hasSwitch(name) || argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`))),
  );
}

/** Main adds `--no-sandbox` itself when the exception applies and the launcher did not pass it (the `.tar.gz`). */
export function needsNoSandbox(ctx: SwitchContext & { present: boolean }): boolean {
  return sandboxExempt(ctx) && !ctx.present;
}
