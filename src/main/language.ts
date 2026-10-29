/**
 * The active language (007 FR-014 to FR-016, research §3): main reads the OS preferred languages, at start,
 * on window focus and every minute while the setting is Use system language (Electron has no change event).
 */
import { resolveLanguage, type Lang, type LanguageSetting } from "../domain/language";
import { errorMessage, type Logger } from "./log";

const CHECK_MS = 60_000;

interface Timer {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

export interface LanguageWatcherOptions {
  setting: LanguageSetting;
  /** The OS preferred languages, in order. */
  read: () => readonly string[];
  timer: Timer;
  onChange: (lang: Lang) => void;
  log: Logger;
}

export class LanguageWatcher {
  private setting: LanguageSetting;
  private current: Lang;
  private handle: unknown = null;
  private readFailed = false;

  constructor(private readonly opts: LanguageWatcherOptions) {
    this.setting = opts.setting;
    this.current = this.resolve();
    this.schedule();
  }

  language(): Lang {
    return this.current;
  }

  /** A new setting from Settings; returns the active language (FR-016). No onChange: the caller replies. */
  setSetting(setting: LanguageSetting): Lang {
    this.setting = setting;
    this.current = this.resolve();
    this.schedule();
    return this.current;
  }

  onFocus(): void {
    this.check();
  }

  /** Re-reads the OS list; reports a change of the active language (FR-015). */
  check(): void {
    if (this.setting !== "system") return;
    const next = this.resolve();
    if (next === this.current) return;
    this.current = next;
    this.opts.onChange(next);
  }

  stop(): void {
    if (this.handle !== null) this.opts.timer.clearInterval(this.handle);
    this.handle = null;
  }

  private schedule(): void {
    if (this.setting === "system" && this.handle === null) {
      this.handle = this.opts.timer.setInterval(() => {
        this.check();
      }, CHECK_MS);
    } else if (this.setting !== "system") {
      this.stop();
    }
  }

  private resolve(): Lang {
    if (this.setting !== "system") return this.setting;
    let list: readonly string[] = [];
    try {
      list = this.opts.read();
    } catch (err) {
      if (!this.readFailed) this.opts.log.warn("language.os-read-failed", { message: errorMessage(err) });
      this.readFailed = true;
    }
    return resolveLanguage("system", list);
  }
}

/**
 * The OS list, replaceable in unpackaged builds for tests: `VESTA_TEST_OS_LANGS` (comma-separated) at start,
 * and `setOsLanguages` at run time (contracts/ipc.md "Test hooks"). Packaged builds ignore both.
 */
export function osLanguageSource(opts: {
  isPackaged: boolean;
  env: Readonly<Record<string, string | undefined>>;
  readOs: () => readonly string[];
}): { read: () => readonly string[]; setOsLanguages: (list: readonly string[]) => void } {
  const fromEnv = opts.env["VESTA_TEST_OS_LANGS"];
  let override: readonly string[] | null =
    !opts.isPackaged && fromEnv !== undefined && fromEnv.trim() !== ""
      ? fromEnv
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "")
      : null;
  return {
    read: () => override ?? opts.readOs(),
    setOsLanguages: (list) => {
      if (!opts.isPackaged) override = [...list];
    },
  };
}
