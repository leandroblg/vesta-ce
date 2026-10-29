import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

const MAIN = resolve(import.meta.dirname, "../../../out/main/index.js");

export function freshDataDir(): string {
  return join(mkdtempSync(join(tmpdir(), "vesta-e2e-")), "Vesta");
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
  dataDir: string;
}

export interface LaunchOptions {
  dataDir?: string;
  env?: Record<string, string>;
  /** Wait for the main view to finish loading (default true). */
  waitReady?: boolean;
  /** Extra Chromium/Electron command-line arguments, such as --log-net-log (009). */
  args?: string[];
}

/** Launches the built app with a throwaway VESTA_DATA_DIR (quickstart.md). */
export async function launchVesta(options: LaunchOptions = {}): Promise<Launched> {
  const dataDir = options.dataDir ?? freshDataDir();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  // The VS Code extension host sets this; with it Electron would run as plain Node.
  delete env["ELECTRON_RUN_AS_NODE"];
  delete env["ELECTRON_RENDERER_URL"];
  // 007: the OS language list is pinned to English, so specs read English text on any CI machine (T036);
  // a spec passes its own VESTA_TEST_OS_LANGS to test other languages.
  // 009 FR-028: the update check always uses the fixture transport; `empty` answers an empty release list, so
  // the check at start ends up to date with no Warn and no spec ever contacts GitHub (contracts/ipc.md).
  Object.assign(env, { VESTA_DATA_DIR: dataDir, VESTA_TEST_OS_LANGS: "en-US", VESTA_TEST_RELEASES: "empty" }, options.env ?? {});

  const app = await electron.launch({ args: [MAIN, ...(options.args ?? [])], env });
  const page = await app.firstWindow();
  if (options.waitReady ?? true) {
    await page.locator("main[aria-busy='false']").waitFor();
  }
  return { app, page, dataDir };
}

export async function relaunch(previous: Launched, options: Omit<LaunchOptions, "dataDir"> = {}): Promise<Launched> {
  await previous.app.close();
  return launchVesta({ ...options, dataDir: previous.dataDir });
}
