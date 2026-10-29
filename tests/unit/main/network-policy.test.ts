import { describe, expect, it } from "vitest";
import { networkAllowed } from "../../../src/main/security";

describe("networkAllowed (constitution I, 005 FR-036)", () => {
  it("allows the youtube-nocookie player and what it loads from inside its frame", () => {
    expect(networkAllowed("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", null)).toBe(true);
    expect(networkAllowed("https://i.ytimg.com/vi/x.jpg", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe(
      true,
    );
  });

  it("refuses everything else", () => {
    expect(networkAllowed("https://www.youtube.com/embed/dQw4w9WgXcQ", null)).toBe(false);
    expect(networkAllowed("https://example.com/x.png", "file:///app/index.html")).toBe(false);
    expect(networkAllowed("http://www.youtube-nocookie.com/embed/x", null)).toBe(false);
    expect(networkAllowed("https://www.youtube-nocookie.com.evil.example/embed/x", null)).toBe(false);
    expect(networkAllowed("https://i.ytimg.com/vi/x.jpg", "https://www.youtube-nocookie.com.evil.example/")).toBe(
      false,
    );
  });

  it("leaves non-network schemes alone", () => {
    expect(networkAllowed("file:///app/index.html", null)).toBe(true);
    expect(networkAllowed("vesta-asset://assets/x", null)).toBe(true);
    expect(networkAllowed("devtools://devtools/x", null)).toBe(true);
  });
});

describe("networkAllowed: the update check (009 FR-022; checklist CHK001, CHK003, CHK030)", () => {
  const repo = { owner: "OWNER", repo: "vesta" };
  it("allows exactly the Vesta repository's release list on the GitHub API", () => {
    expect(networkAllowed("https://api.github.com/repos/OWNER/vesta/releases?per_page=20", null, repo)).toBe(true);
    expect(networkAllowed("https://api.github.com/repos/OWNER/vesta/releases", null, repo)).toBe(true);
  });

  it("refuses other GitHub hosts, repositories, paths and look-alikes", () => {
    for (const url of [
      "https://api.github.com/repos/OTHER/vesta/releases",
      "https://api.github.com/repos/OWNER/vesta/releases/latest",
      "https://api.github.com/repos/OWNER/vesta",
      "https://api.github.com/users/x",
      "https://github.com/OWNER/vesta/releases",
      "https://objects.githubusercontent.com/x",
      "http://api.github.com/repos/OWNER/vesta/releases",
      "https://api.github.com.evil.example/repos/OWNER/vesta/releases",
      "https://user@api.github.com/repos/OWNER/vesta/releases",
      "wss://api.github.com/repos/OWNER/vesta/releases",
    ]) {
      expect(networkAllowed(url, null, repo), url).toBe(false);
    }
  });

  it("refuses the release list when no repository is configured", () => {
    expect(networkAllowed("https://api.github.com/repos/OWNER/vesta/releases", null)).toBe(false);
  });
});
