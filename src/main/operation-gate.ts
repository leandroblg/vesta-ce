/**
 * One export, import or Undo import offer at a time (008 research §7, FR-050, FR-037c). While it is not idle,
 * the automatic backup and the hourly purge wait; a run that came due is queued once and runs when it is idle.
 */
export type GateState = "idle" | "exporting" | "importing" | "undoOffered";

export class OperationGate {
  private current: GateState = "idle";
  private endOffer: (() => void) | null = null;
  private readonly queued = new Set<() => void>();

  state(): GateState {
    return this.current;
  }

  maintenanceAllowed(): boolean {
    return this.current === "idle";
  }

  /**
   * False while an export or import runs. A pending undo offer is ended (FR-037b) after the gate has moved
   * straight to the new operation, so the queued backup and purge never run in between.
   */
  tryBegin(kind: "export" | "import"): boolean {
    if (this.current === "exporting" || this.current === "importing") return false;
    const endOffer = this.current === "undoOffered" ? this.endOffer : null;
    this.endOffer = null;
    this.current = kind === "export" ? "exporting" : "importing";
    endOffer?.();
    return true;
  }

  /** After a successful import: the gate stays closed until `end` runs (the offer's end calls it while offered). */
  offerUndo(endOffer: () => void): void {
    this.current = "undoOffered";
    this.endOffer = endOffer;
  }

  end(): void {
    if (this.current === "idle") return;
    this.current = "idle";
    this.endOffer = null;
    const due = [...this.queued];
    this.queued.clear();
    for (const fn of due) fn();
  }

  whenIdle(fn: () => void): void {
    if (this.current === "idle") fn();
    else this.queued.add(fn);
  }
}
