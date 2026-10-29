/**
 * Schedules alert ticks and times blink episodes (003 research §4, §9). The rules run in main; the renderer
 * only says whether the main view is visible and plays what each tick returns.
 */
import { rendererClock } from "../clock";
import { reportError } from "../report";
import { actions, setTickRequester, useVesta } from "../store/store";

const TICK_MS = 60_000;
const BLINK_MS = 800;

let started = false;
let inFlight = false;
let queued = false;
let finished = 0;

/**
 * The main view is on screen: the window is visible and the Tasks view is shown (FR-018, Q93). An active
 * search counts as not visible, so no blink plays until it is cleared (006 FR-005a, research §8).
 */
function mainViewVisible(): boolean {
  const s = useVesta.getState();
  return document.visibilityState === "visible" && s.view === "tasks" && !s.search.active;
}

/** Asks main for a tick now; calls are coalesced (one in flight, at most one queued). */
export function requestTick(): void {
  if (!started) return;
  if (inFlight) {
    queued = true;
    return;
  }
  inFlight = true;
  void runTick();
}

async function runTick(): Promise<void> {
  try {
    const result = await window.vesta.alerts.tick({ visible: mainViewVisible() });
    if (result.ok) {
      const startedAt = rendererClock.now();
      actions.applyAlertTick(result.value, startedAt);
      for (const e of result.value.episodes) scheduleEnd(e.id, e.blinks, startedAt);
    } else {
      reportError("alerts.tick", result.error.message);
    }
  } catch (err) {
    reportError("alerts.tick", err);
  } finally {
    inFlight = false;
    finished += 1;
    // Lets end-to-end tests wait for a tick to be applied.
    document.documentElement.dataset["alertTicks"] = String(finished);
    if (queued) {
      queued = false;
      requestTick();
    }
  }
}

/** Ends an episode after its blinks; an episode on the row being edited waits for the edit to close. */
function scheduleEnd(id: string, blinks: 1 | 3, startedAt: number): void {
  if (useVesta.getState().editingKey === id) return;
  setTimeout(() => {
    actions.endEpisode(id, startedAt);
  }, blinks * BLINK_MS);
}

/** Starts the 60 s timer and the triggers, and ticks once at once (FR-010, FR-018). */
export function startAlertDriver(): void {
  if (started) return;
  started = true;
  setTickRequester(requestTick);
  setInterval(requestTick, TICK_MS);
  document.addEventListener("visibilitychange", requestTick);
  window.addEventListener("focus", requestTick);
  window.vesta.on("alerts:wake", requestTick);
  useVesta.subscribe((state, prev) => {
    if (state.view !== prev.view || state.search.active !== prev.search.active) requestTick();
    // An inline edit closed: an episode that waited on that row starts now.
    if (prev.editingKey !== null && state.editingKey !== prev.editingKey) {
      const waiting = state.episodes[prev.editingKey];
      if (waiting !== undefined) {
        const startedAt = rendererClock.now();
        actions.restartEpisode(prev.editingKey, startedAt);
        scheduleEnd(prev.editingKey, waiting.blinks, startedAt);
      }
    }
  });
  requestTick();
}
