import { describe, expect, it } from "vitest";
import { hostOnly, redact } from "../../../../src/domain/logs/redact";

describe("redact (009 FR-003, research §4)", () => {
  it("writes the home folder as ~ in every string, stacks included", () => {
    const home = "/Users/ana";
    expect(redact({ dataDir: "/Users/ana/Library/Application Support/Vesta", n: 3 }, home)).toEqual({ dataDir: "~/Library/Application Support/Vesta", n: 3 });
    expect(redact({ stack: "Error: x\n    at f (/Users/ana/app/main.js:1:2)\n    at /Users/ana" }, home)).toEqual({ stack: "Error: x\n    at f (~/app/main.js:1:2)\n    at ~" });
    expect(redact({ ids: ["/Users/ana/a", "b"] }, home)).toEqual({ ids: ["~/a", "b"] });
  });

  it("leaves another user's folder alone, even when the home is a prefix of it", () => {
    expect(redact({ p: "/Users/anabel/x" }, "/Users/ana")).toEqual({ p: "/Users/anabel/x" });
    expect(redact({ p: "/Users/an/x and /Users/ana/y" }, "/Users/an")).toEqual({ p: "~/x and /Users/ana/y" });
  });

  it("handles a Windows home with backslashes, whatever the case", () => {
    const home = "C:\\Users\\Ana";
    expect(redact({ p: "C:\\Users\\Ana\\AppData\\Roaming\\Vesta" }, home)).toEqual({ p: "~\\AppData\\Roaming\\Vesta" });
    expect(redact({ p: "c:\\users\\ana\\x" }, home)).toEqual({ p: "~\\x" });
  });

  it("changes nothing when the home is unknown", () => {
    expect(redact({ p: "/Users/ana/x" }, "")).toEqual({ p: "/Users/ana/x" });
  });
});

describe("hostOnly (009 FR-003, FR-022c)", () => {
  it("keeps only the scheme and host of an address", () => {
    expect(hostOnly("https://example.com/a?b=c#d")).toEqual({ scheme: "https", host: "example.com" });
    expect(hostOnly("file:///Users/ana/x.html")).toEqual({ scheme: "file", host: "" });
    expect(hostOnly("not a url")).toEqual({ scheme: null, host: null });
  });
});
