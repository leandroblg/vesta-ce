import type { VestaApi } from "../shared/ipc-contract";
import type { TestHooks } from "./test-hooks";

declare global {
  interface Window {
    /** Exposed by src/preload/index.ts; the only bridge to the main process. */
    readonly vesta: VestaApi;
    /** Unpackaged builds only (004 research §8). */
    __vestaTest?: TestHooks;
  }
}

export {};
