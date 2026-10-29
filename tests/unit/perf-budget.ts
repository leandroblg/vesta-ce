/**
 * The time a speed check allows. The target stands on a developer machine; a shared CI runner gets three times as
 * long, still enough to catch a regression. The checks live in `*.perf.test.ts` and run one file at a time
 * (`npm run test:perf`).
 */
export function budget(ms: number): number {
  return process.env["CI"] ? ms * 3 : ms;
}
