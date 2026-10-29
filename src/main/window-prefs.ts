/** The main window's web preferences (001 research §9; 010 FR-021: no developer tools in packaged builds, L5). */
export interface WindowPreferences {
  preload: string;
  contextIsolation: true;
  nodeIntegration: false;
  sandbox: true;
  webSecurity: true;
  spellcheck: false;
  devTools: boolean;
}

export function windowPreferences(options: { isPackaged: boolean; preload: string }): WindowPreferences {
  return {
    preload: options.preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: false,
    devTools: !options.isPackaged,
  };
}

/**
 * 017 FR-011a: on Linux the window and taskbar icon comes from the window itself (the .tar.gz has no desktop entry),
 * so a packaged build points it at the PNG electron-builder copies into its resources; elsewhere the system shows the
 * app's own icon.
 */
export function windowIcon(options: { platform: string; packaged: boolean; resourcesPath: string }): string | undefined {
  return options.platform === "linux" && options.packaged ? `${options.resourcesPath}/icon.png` : undefined;
}
