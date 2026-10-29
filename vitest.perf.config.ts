import { defineConfig } from "vitest/config";

/** The speed checks, kept out of `npm test` and run one file at a time so the rest of the suite does not slow them. */
export default defineConfig({
  test: {
    name: "perf",
    include: ["tests/unit/**/*.perf.test.ts"],
    environment: "node",
    fileParallelism: false,
  },
});
