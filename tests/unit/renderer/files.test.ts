// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notices: string[] = [];
const reports: string[] = [];
vi.mock("../../../src/renderer/store/store", () => ({
  actions: {
    showAssetNotice: (text: string) => {
      notices.push(text);
    },
  },
}));
vi.mock("../../../src/renderer/report", () => ({
  reportError: (context: string) => {
    reports.push(context);
  },
}));
vi.mock("../../../src/renderer/i18n/t", () => ({
  t: (key: string, vars?: Record<string, string>) => `${key}:${vars?.["n"] ?? ""}`,
}));

import { importLinkPath } from "../../../src/renderer/editor/files";

type Outcome = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };

function bridge(outcome: Outcome): { calls: unknown[] } {
  const calls: unknown[] = [];
  (window as unknown as { vesta: unknown }).vesta = {
    assets: {
      importPath: (payload: unknown) => {
        calls.push(payload);
        return Promise.resolve(outcome);
      },
    },
  };
  return { calls };
}

describe("M1 the typed-path outcomes in the editor (010 FR-001, FR-002)", () => {
  beforeEach(() => {
    notices.length = 0;
    reports.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("M1 a confirmed copy comes back as the link's target", async () => {
    const ref = { ref: `assets/${"a".repeat(64)}.pdf`, name: "report.pdf", isImage: false };
    const { calls } = bridge({ ok: true, value: ref });
    expect(await importLinkPath("/Users/ana/Documents/report.pdf", "details")).toEqual(ref);
    expect(calls).toEqual([{ path: "/Users/ana/Documents/report.pdf", scope: "details" }]);
    expect(notices).toEqual([]);
  });

  it("M1 Cancel is quiet: null, no notice, no error report", async () => {
    bridge({ ok: false, error: { code: "CANCELLED", message: "report.pdf was not added" } });
    expect(await importLinkPath("/Users/ana/Documents/report.pdf", "details")).toBeNull();
    expect(notices).toEqual([]);
    expect(reports).toEqual([]);
  });

  it("M1 a path inside the data folder shows the fileInsideData message with the typed name", async () => {
    bridge({ ok: false, error: { code: "INSIDE_DATA", message: "x" } });
    expect(await importLinkPath("file:///Users/ana/Library/Application%20Support/Vesta/data.sqlite", "details")).toBeNull();
    expect(notices).toEqual(["fileInsideData:data.sqlite"]);
  });

  it("M1 the 005 refusals keep their messages", async () => {
    bridge({ ok: false, error: { code: "NOT_FOUND", message: "x" } });
    await importLinkPath("/tmp/missing.pdf", "details");
    bridge({ ok: false, error: { code: "TOO_LARGE", message: "x" } });
    await importLinkPath("/tmp/huge.bin", "details");
    expect(notices).toEqual(["fileMissing:missing.pdf", "fileTooBig:huge.bin"]);
  });
});
