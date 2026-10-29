// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountEmbed } from "../../../src/renderer/markdown/youtube";

const URL_ = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function online(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

describe("mountEmbed (FR-034)", () => {
  afterEach(() => {
    vi.useRealTimers();
    online(true);
  });

  it("online: a sandboxed youtube-nocookie player, nothing else", () => {
    online(true);
    const box = document.createElement("div");
    mountEmbed(box, "dQw4w9WgXcQ", URL_);
    const frame = box.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-presentation");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(box.querySelectorAll("img")).toHaveLength(0);
  });

  it("offline: the placeholder with the link at once", () => {
    online(false);
    const box = document.createElement("div");
    mountEmbed(box, "dQw4w9WgXcQ", URL_);
    expect(box.querySelector("iframe")).toBeNull();
    expect(box.textContent).toBe(`YouTube video (offline): ${URL_}`);
    expect(box.querySelector("a")?.getAttribute("href")).toBe(URL_);
  });

  it("no load within 10 s, or an offline event: the placeholder", () => {
    vi.useFakeTimers();
    online(true);
    const slow = document.createElement("div");
    mountEmbed(slow, "dQw4w9WgXcQ", URL_);
    vi.advanceTimersByTime(9_999);
    expect(slow.querySelector("iframe")).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(slow.querySelector("[data-yt-offline]")).not.toBeNull();

    const loaded = document.createElement("div");
    mountEmbed(loaded, "dQw4w9WgXcQ", URL_);
    loaded.querySelector("iframe")?.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(20_000);
    expect(loaded.querySelector("iframe")).not.toBeNull();
    window.dispatchEvent(new Event("offline"));
    expect(loaded.querySelector("[data-yt-offline]")).not.toBeNull();
  });
});

describe("L2 the player is built only from a valid id (010 FR-015)", () => {
  afterEach(() => {
    vi.useRealTimers();
    online(true);
  });

  it.each(["", "../../x?autoplay=1", "dQw4w9WgXc", "dQw4w9WgXcQ/extra"])("L2 renders the link as text for the invalid id %j", (id) => {
    online(true);
    const box = document.createElement("div");
    mountEmbed(box, id, URL_);
    expect(box.querySelectorAll("iframe")).toHaveLength(0);
    const link = box.querySelector("a");
    expect(link?.getAttribute("href")).toBe(URL_);
    expect(box.textContent).toContain(URL_);
  });
});
