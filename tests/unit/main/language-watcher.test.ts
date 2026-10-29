import { describe, expect, it, vi } from "vitest";
import { LanguageWatcher, osLanguageSource } from "../../../src/main/language";
import type { Logger } from "../../../src/main/log";

function fakeTimer() {
  const timers = new Map<number, () => void>();
  let next = 1;
  return {
    timers,
    setInterval: (fn: () => void) => {
      const id = next++;
      timers.set(id, fn);
      return id;
    },
    clearInterval: (h: unknown) => {
      timers.delete(h as number);
    },
    fire: () => {
      for (const fn of timers.values()) fn();
    },
  };
}

const log = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) as unknown as Logger & { warn: ReturnType<typeof vi.fn> };

describe("LanguageWatcher (007 FR-014 to FR-016, research §3)", () => {
  it("computes the language at construction", () => {
    const w = new LanguageWatcher({ setting: "system", read: () => ["de-DE", "fr-FR"], timer: fakeTimer(), onChange: vi.fn(), log: log() });
    expect(w.language()).toBe("fr");
  });

  it("re-reads the OS list on focus and every minute while the setting is Use system language", () => {
    let list = ["en-US"];
    const timer = fakeTimer();
    const onChange = vi.fn();
    const w = new LanguageWatcher({ setting: "system", read: () => list, timer, onChange, log: log() });
    expect(timer.timers.size).toBe(1);
    list = ["es-MX"];
    w.onFocus();
    expect(onChange).toHaveBeenCalledWith("es-ES");
    list = ["it-IT"];
    timer.fire();
    expect(onChange).toHaveBeenLastCalledWith("it");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("calls onChange only when the result changes", () => {
    const timer = fakeTimer();
    const onChange = vi.fn();
    new LanguageWatcher({ setting: "system", read: () => ["en-GB"], timer, onChange, log: log() });
    timer.fire();
    timer.fire();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("runs the timer only while the setting is Use system language", () => {
    const timer = fakeTimer();
    const onChange = vi.fn();
    const w = new LanguageWatcher({ setting: "fr", read: () => ["en"], timer, onChange, log: log() });
    expect(w.language()).toBe("fr");
    expect(timer.timers.size).toBe(0);
    expect(w.setSetting("system")).toBe("en");
    expect(timer.timers.size).toBe(1);
    expect(w.setSetting("it")).toBe("it");
    expect(timer.timers.size).toBe(0);
    w.onFocus();
    expect(w.language()).toBe("it");
  });

  it("falls back to English when the OS call throws, and logs it once", () => {
    const l = log();
    const timer = fakeTimer();
    const w = new LanguageWatcher({
      setting: "system",
      read: () => {
        throw new Error("no locale");
      },
      timer,
      onChange: vi.fn(),
      log: l,
    });
    timer.fire();
    w.onFocus();
    expect(w.language()).toBe("en");
    expect(l.warn).toHaveBeenCalledTimes(1);
  });
});

describe("osLanguageSource test hooks (contracts/ipc.md)", () => {
  it("unpackaged builds take VESTA_TEST_OS_LANGS and setOsLanguages", () => {
    const src = osLanguageSource({ isPackaged: false, env: { VESTA_TEST_OS_LANGS: "fr-FR, en" }, readOs: () => ["en-US"] });
    expect(src.read()).toEqual(["fr-FR", "en"]);
    src.setOsLanguages(["it"]);
    expect(src.read()).toEqual(["it"]);
  });

  it("packaged builds ignore both", () => {
    const src = osLanguageSource({ isPackaged: true, env: { VESTA_TEST_OS_LANGS: "fr-FR" }, readOs: () => ["en-US"] });
    expect(src.read()).toEqual(["en-US"]);
    src.setOsLanguages(["it"]);
    expect(src.read()).toEqual(["en-US"]);
  });
});
