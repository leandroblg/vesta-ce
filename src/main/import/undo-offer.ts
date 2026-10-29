/**
 * The Undo import offer (008 research §6; FR-037a to FR-037c): 60 s on the app clock after a successful import,
 * checked every second so the test clock can move past it. Ending it (at the deadline or earlier) runs `onEnd`
 * once: promote the pre-import backup and free the gate.
 */
import type { Clock } from "../../domain/clock";

export const UNDO_IMPORT_MS = 60_000;
const CHECK_MS = 1_000;

interface Timer {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export class UndoImportOffer {
  private offer: { token: string; deadline: number; onEnd: () => void; handle: unknown } | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly timer: Timer,
    private readonly newToken: () => string,
  ) {}

  start(onEnd: () => void): { token: string; deadline: number } {
    this.end();
    const token = this.newToken();
    const deadline = this.clock.now() + UNDO_IMPORT_MS;
    const handle = this.timer.setInterval(() => {
      if (this.clock.now() >= deadline) this.end();
    }, CHECK_MS);
    this.offer = { token, deadline, onEnd, handle };
    return { token, deadline };
  }

  current(): { token: string; deadline: number } | null {
    return this.offer === null ? null : { token: this.offer.token, deadline: this.offer.deadline };
  }

  isValid(token: string): boolean {
    return this.offer !== null && this.offer.token === token && this.clock.now() < this.offer.deadline;
  }

  end(): void {
    const offer = this.offer;
    if (offer === null) return;
    this.offer = null;
    this.timer.clearInterval(offer.handle);
    offer.onEnd();
  }
}
