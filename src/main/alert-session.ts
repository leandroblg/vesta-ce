/**
 * Whether the main view is on screen, and since when (003 research §3). Fed by the renderer's ticks, the
 * window's own state and power events; kept in memory only, so after a restart nothing has been visible
 * yet (FR-018). The window state is needed because Electron may keep `document.visibilityState` at
 * "visible" while the window is minimized or hidden.
 */
import type { Clock } from "../domain/clock";

export interface Visibility {
  visible: boolean;
  visibleSince: number | null;
}

export class AlertSession {
  private visible = false;
  private visibleSince: number | null = null;
  private suspended = false;
  private windowVisible = true;
  private reported = false;

  constructor(private readonly clock: Clock) {}

  /** The renderer's view of the main view; a change to visible starts a new visibleSince. */
  report(visible: boolean): void {
    this.reported = visible;
    this.update();
  }

  /** The window is shown and not minimized (BrowserWindow show/hide/minimize/restore). */
  setWindowVisible(visible: boolean): void {
    this.windowVisible = visible;
    this.update();
  }

  private update(): void {
    const now = this.reported && this.windowVisible && !this.suspended;
    if (now && !this.visible) this.visibleSince = this.clock.now();
    this.visible = now;
  }

  suspend(): void {
    this.suspended = true;
    this.update();
  }

  /** Still not visible: the next visible report after waking restarts visibleSince. */
  resume(): void {
    this.suspended = false;
    this.reported = false;
  }

  visibility(): Visibility {
    return { visible: this.visible, visibleSince: this.visibleSince };
  }
}
