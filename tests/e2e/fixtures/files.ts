/** 010 contracts/ipc.md "Test hooks": the confirmation dialog for typed paths (M1), answered without showing. */
import type { ElectronApplication } from "@playwright/test";

type Hooks = { setNextConfirm: (answer: boolean | null) => void; confirmRequests: () => { name: string; folder: string }[] };

/** The next confirmation answers `answer` (true = Add); `null` restores the real dialog. */
export async function nextConfirm(app: ElectronApplication, answer: boolean | null): Promise<void> {
  await app.evaluate((_electron, a) => {
    (globalThis as unknown as { __vestaTest: Hooks }).__vestaTest.setNextConfirm(a);
  }, answer);
}

/** What the dialogs would have shown, in order. */
export function confirmRequests(app: ElectronApplication): Promise<{ name: string; folder: string }[]> {
  return app.evaluate(() => (globalThis as unknown as { __vestaTest: Hooks }).__vestaTest.confirmRequests());
}
