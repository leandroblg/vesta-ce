import { defineConfig } from "vitest/config";

/** 017: checks of a finished beta build in release/, run only by `npm run test:package` (FR-021). */
export default defineConfig({
  test: {
    name: "package",
    include: ["tests/package/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    // A skipped group is named by the skip message (FR-021), so the verbose reporter shows it.
    reporters: ["verbose"],
  },
});
