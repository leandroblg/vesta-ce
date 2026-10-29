/**
 * 018 (FR-017, quickstart.md): runs the hourly purge, with both automatic cleanups, once and waits for it. The real
 * hourly timer cannot be moved by the app clock, so specs move the clock (`advanceClock`) and then call this.
 */
import type { ElectronApplication } from "@playwright/test";

/** Runs the purge callback through its maintenance gate (unpackaged builds only) and resolves when it has run. */
export async function runPurge(app: ElectronApplication): Promise<void> {
  await app.evaluate(async () => {
    await (globalThis as unknown as { __vestaTest: { runPurge(): Promise<void> } }).__vestaTest.runPurge();
  });
}
