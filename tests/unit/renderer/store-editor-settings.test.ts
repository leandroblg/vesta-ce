// @vitest-environment jsdom
// 011 FR-016, FR-020b: the color lists and the table size order go through settingCall.
import { beforeEach, describe, expect, it } from "vitest";
import { visible } from "../../../src/domain/notifications";
import { actions, useVesta } from "../../../src/renderer/store/store";

type Outcome = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
const calls: { channel: string; payload: unknown }[] = [];

function bridge(outcome: Outcome): void {
  const reply = (channel: string) => (payload: unknown) => {
    calls.push({ channel, payload });
    return Promise.resolve(outcome);
  };
  (window as unknown as { vesta: unknown }).vesta = {
    settings: { setColorLists: reply("setColorLists"), setTableRowsFirst: reply("setTableRowsFirst") },
    app: { logError: () => Promise.resolve({ ok: true, value: null }) },
  };
}

describe("011 editor settings in the store", () => {
  beforeEach(() => {
    calls.length = 0;
    useVesta.setState({ notifications: { current: null, waiting: [] }, pinnedColors: [], recentColors: [], tableRowsFirst: false });
  });

  it("FR-016 setColorLists sends both keys with null for an absent list and updates state after success", async () => {
    bridge({ ok: true, value: null });
    expect(await actions.setColorLists({ pinned: ["#000001ff"], pinnedNow: "#000001ff" })).toBe(true);
    expect(calls).toEqual([{ channel: "setColorLists", payload: { pinned: ["#000001ff"], recent: null, pinnedNow: "#000001ff" } }]);
    expect(useVesta.getState().pinnedColors).toEqual(["#000001ff"]);
    expect(useVesta.getState().recentColors).toEqual([]);
  });

  it("FR-020b setTableRowsFirst updates state after success", async () => {
    bridge({ ok: true, value: null });
    expect(await actions.setTableRowsFirst(true)).toBe(true);
    expect(useVesta.getState().tableRowsFirst).toBe(true);
  });

  it("FR-016 a failed save leaves the state and shows Changes are not saved", async () => {
    bridge({ ok: false, error: { code: "SAVE_FAILED", message: "disk" } });
    expect(await actions.setColorLists({ recent: ["#000002ff"] })).toBe(false);
    expect(useVesta.getState().recentColors).toEqual([]);
    const shown = visible(useVesta.getState().notifications);
    expect(shown?.type === "sticky" && shown.kind === "saveFailed").toBe(true);
  });
});
