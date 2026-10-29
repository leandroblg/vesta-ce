// T022: the operation gate (research §7, FR-050, FR-037c): one export, import or undo offer at a time, and the
// backup and purge held until it is idle.
import { describe, expect, it, vi } from "vitest";
import { OperationGate } from "../../../src/main/operation-gate";

describe("OperationGate", () => {
  it("starts idle and allows maintenance", () => {
    const gate = new OperationGate();
    expect(gate.state()).toBe("idle");
    expect(gate.maintenanceAllowed()).toBe(true);
  });

  it("refuses a second operation while one runs", () => {
    const gate = new OperationGate();
    expect(gate.tryBegin("export")).toBe(true);
    expect(gate.state()).toBe("exporting");
    expect(gate.tryBegin("import")).toBe(false);
    expect(gate.tryBegin("export")).toBe(false);
    gate.end();
    expect(gate.tryBegin("import")).toBe(true);
    expect(gate.state()).toBe("importing");
  });

  it("holds maintenance while exporting, importing or offering Undo import", () => {
    const gate = new OperationGate();
    gate.tryBegin("import");
    expect(gate.maintenanceAllowed()).toBe(false);
    gate.offerUndo(() => undefined);
    expect(gate.state()).toBe("undoOffered");
    expect(gate.maintenanceAllowed()).toBe(false);
  });

  it("ends the undo offer when a new operation begins, without running queued maintenance in between", () => {
    const gate = new OperationGate();
    const backup = vi.fn();
    const seen: string[] = [];
    const endOffer = vi.fn(() => {
      seen.push(gate.state());
      if (gate.state() === "undoOffered") gate.end();
    });
    gate.tryBegin("import");
    gate.offerUndo(endOffer);
    gate.whenIdle(backup);
    expect(gate.tryBegin("export")).toBe(true);
    expect(endOffer).toHaveBeenCalledOnce();
    expect(seen).toEqual(["exporting"]);
    expect(backup).not.toHaveBeenCalled();
    expect(gate.state()).toBe("exporting");
    gate.end();
    expect(backup).toHaveBeenCalledOnce();
  });

  it("runs each queued callback once when it goes idle, deduping the same callback", () => {
    const gate = new OperationGate();
    const backup = vi.fn();
    const purge = vi.fn();
    gate.tryBegin("export");
    gate.whenIdle(backup);
    gate.whenIdle(backup);
    gate.whenIdle(purge);
    expect(backup).not.toHaveBeenCalled();
    gate.end();
    expect(backup).toHaveBeenCalledOnce();
    expect(purge).toHaveBeenCalledOnce();
    gate.tryBegin("import");
    gate.end();
    expect(backup).toHaveBeenCalledOnce();
  });

  it("runs a callback at once when already idle", () => {
    const gate = new OperationGate();
    const fn = vi.fn();
    gate.whenIdle(fn);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("stays idle-safe: end() when idle does nothing", () => {
    const gate = new OperationGate();
    gate.end();
    expect(gate.state()).toBe("idle");
  });
});
