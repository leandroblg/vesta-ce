import { describe, expect, it } from "vitest";
import { DENIED_SWITCHES, needsNoSandbox, refusedSwitches } from "../../../src/domain/startup/switches";

const none = () => false;

describe("L12 denied command-line switches (010 FR-022, research §8)", () => {
  it("L12 names exactly the switches of FR-022", () => {
    expect([...DENIED_SWITCHES]).toEqual([
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
    ]);
  });

  it("L12 finds a switch through the parsed command line", () => {
    expect(refusedSwitches((n) => n === "remote-debugging-port", [])).toEqual(["remote-debugging-port"]);
  });

  it.each([
    ["--no-sandbox", "no-sandbox"],
    ["--proxy-server=127.0.0.1:8080", "proxy-server"],
    ["--js-flags=--expose-gc", "js-flags"],
    ["--inspect=0", "inspect"],
  ])("L12 finds %s in the raw arguments", (arg, name) => {
    expect(refusedSwitches(none, ["/app/Vesta", arg])).toEqual([name]);
  });

  it("L12 returns every match in list order and ignores ordinary arguments", () => {
    expect(refusedSwitches((n) => n === "host-rules", ["--disable-web-security", "--remote-debugging-pipe"])).toEqual([
      "remote-debugging-pipe",
      "disable-web-security",
      "host-rules",
    ]);
    expect(refusedSwitches(none, ["/app/Vesta", "--log-net-log=/tmp/net.json", "--lang=en", "file.txt"])).toEqual([]);
    expect(refusedSwitches(none, ["--inspector", "--no-sandboxed"])).toEqual([]); // prefixes are not matches
  });
});

describe("Linux sandbox exception (017 FR-006a, PRD Q265, constitution v1.2.0 principle II)", () => {
  const argv = ["/app/vesta", "--no-sandbox"];
  const ctx = (platform: string, packaged: boolean, sandboxBlocked: boolean) => ({ platform, packaged, sandboxBlocked });

  it("accepts --no-sandbox on a packaged Linux build where user namespaces are blocked", () => {
    expect(refusedSwitches(none, argv, ctx("linux", true, true))).toEqual([]);
  });

  it("still refuses it where namespaces work, and on macOS and Windows whatever the probe says", () => {
    expect(refusedSwitches(none, argv, ctx("linux", true, false))).toEqual(["no-sandbox"]);
    for (const platform of ["darwin", "win32"]) {
      expect(refusedSwitches(none, argv, ctx(platform, true, true)), platform).toEqual(["no-sandbox"]);
      expect(refusedSwitches(none, argv, ctx(platform, true, false)), platform).toEqual(["no-sandbox"]);
    }
  });

  it("keeps refusing every other denied switch, also where the exception applies", () => {
    expect(refusedSwitches(none, ["/app/vesta", "--no-sandbox", "--remote-debugging-port=9222"], ctx("linux", true, true))).toEqual(["remote-debugging-port"]);
  });

  it("needs the switch added only on packaged Linux, blocked, when the launcher did not pass it", () => {
    expect(needsNoSandbox({ platform: "linux", packaged: true, sandboxBlocked: true, present: false })).toBe(true);
    expect(needsNoSandbox({ platform: "linux", packaged: true, sandboxBlocked: true, present: true })).toBe(false);
    expect(needsNoSandbox({ platform: "linux", packaged: true, sandboxBlocked: false, present: false })).toBe(false);
    expect(needsNoSandbox({ platform: "linux", packaged: false, sandboxBlocked: true, present: false })).toBe(false);
    expect(needsNoSandbox({ platform: "darwin", packaged: true, sandboxBlocked: true, present: false })).toBe(false);
    expect(needsNoSandbox({ platform: "win32", packaged: true, sandboxBlocked: true, present: false })).toBe(false);
  });
});
