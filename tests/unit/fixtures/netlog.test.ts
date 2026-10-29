import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostOf, netLogHosts } from "./netlog";

describe("netLogHosts (009 SC-005, research §13)", () => {
  it("reads the hosts looked up or connected to from a real Electron NetLog", () => {
    // Captured from net.fetch to a local server, plus one request the session allow-list cancelled
    // (https://blocked.invalid/x), which leaves no trace in the NetLog.
    expect(netLogHosts(join(import.meta.dirname, "netlog-sample.json"))).toEqual(["localhost"]);
  });

  it("extracts a host from every form Chromium writes", () => {
    expect(hostOf("https://api.github.com:443")).toBe("api.github.com");
    expect(hostOf("ssl/www.youtube-nocookie.com:443")).toBe("www.youtube-nocookie.com");
    expect(hostOf("i.ytimg.com:443")).toBe("i.ytimg.com");
    expect(hostOf("localhost")).toBe("localhost");
    expect(hostOf("[::1]:8080")).toBe("::1");
  });
});
