// Drives the panel-save machine (src/domain/panel-save.ts) with real timers and the save channels (FR-009, FR-010).
import {
  initialPanelSave,
  nextWakeAt,
  panelSaveView,
  step,
  type PanelSave,
  type PanelSaveEvent,
} from "../../../domain/panel-save";
import { rendererClock } from "../../clock";
import { actions, type PanelSaveView } from "../../store/store";

export type PanelField = "title" | "details";

export class PanelSaver {
  private state: PanelSave = initialPanelSave();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty: Record<PanelField, boolean> = { title: false, details: false };
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly taskId: string,
    /** The editors' current text; null for a field with no editor. */
    private readonly read: () => { title: string | null; details: string | null },
    private readonly onView: (view: PanelSaveView) => void,
  ) {}

  edit(field: PanelField): void {
    this.dirty[field] = true;
    this.apply({ type: "edit", now: rendererClock.now() });
  }

  /** Close or switch: a pending edit is sent at once, and nothing more shows (FR-009). */
  close(): Promise<void> {
    this.apply({ type: "close", now: rendererClock.now() });
    this.clearTimer();
    return this.inFlight;
  }

  /** Window close or quit: the pending edit is sent now and awaited. */
  async flush(): Promise<void> {
    if (this.state.phase === "pending" && this.state.dueAt !== null)
      this.apply({ type: "timer", now: this.state.dueAt });
    await this.inFlight;
  }

  private apply(event: PanelSaveEvent): void {
    const { state, effects } = step(this.state, event);
    this.state = state;
    if (!state.closed) this.onView(panelSaveView(state));
    if (effects.includes("save")) this.inFlight = this.save();
    this.schedule();
  }

  private schedule(): void {
    this.clearTimer();
    const at = nextWakeAt(this.state);
    if (at === null) return;
    this.timer = setTimeout(
      () => {
        this.apply({ type: "timer", now: rendererClock.now() });
      },
      Math.max(0, at - rendererClock.now()),
    );
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async save(): Promise<void> {
    // The texts are read now, so a later close or unmount cannot change what this save writes.
    const fields = this.dirty;
    this.dirty = { title: false, details: false };
    const { title, details } = this.read();
    let ok = true;
    // An empty title is never saved (FR-011); the field shows the last saved one again on blur.
    if (fields.title && title !== null && title.trim() !== "")
      ok = (await actions.savePanelTitle(this.taskId, title)) && ok;
    if (fields.details && details !== null) ok = (await actions.editDetails(this.taskId, details)) && ok;
    // A failed field stays dirty, so the next save tries it again (FR-010).
    if (!ok) this.dirty = { title: this.dirty.title || fields.title, details: this.dirty.details || fields.details };
    this.apply({ type: "reply", ok, now: rendererClock.now() });
  }
}
