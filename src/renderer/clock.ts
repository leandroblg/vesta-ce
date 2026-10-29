import type { Clock } from "../domain/clock";

/** The renderer's only reader of the system clock (constitution IV). */
export const rendererClock: Clock = { now: () => Date.now() };
