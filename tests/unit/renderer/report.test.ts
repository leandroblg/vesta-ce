// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_LOG_CONTEXT_CHARS, MAX_LOG_MESSAGE_CHARS, MAX_LOG_STACK_CHARS } from "../../../src/domain/limits";
import { reportError } from "../../../src/renderer/report";

type Report = { message: string; stack: string | null; context: string };

function bridge(): Report[] {
  const sent: Report[] = [];
  (window as unknown as { vesta: unknown }).vesta = {
    app: {
      logError: (r: Report) => {
        sent.push(r);
        return Promise.resolve({ ok: true, value: null });
      },
    },
  };
  return sent;
}

describe("L1 the page shortens error reports to the limits (010 FR-009, research §1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("L1 cuts message, stack and context, keeping the first characters", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sent = bridge();
    const err = new Error("m".repeat(10_000));
    err.stack = "s".repeat(100_000);
    reportError("c".repeat(500), err);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toBe("m".repeat(MAX_LOG_MESSAGE_CHARS));
    expect(sent[0]?.stack).toBe("s".repeat(MAX_LOG_STACK_CHARS));
    expect(sent[0]?.context).toBe("c".repeat(MAX_LOG_CONTEXT_CHARS));
  });

  it("L1 leaves short reports as they are", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sent = bridge();
    reportError("store.run", "plain text");
    expect(sent).toEqual([{ message: "plain text", stack: null, context: "store.run" }]);
  });
});
