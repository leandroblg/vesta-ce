import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["tests/unit/**/*.test.ts"],
          // The speed checks run on their own: vitest.perf.config.ts.
          exclude: ["tests/unit/editor/**", "tests/unit/**/*.perf.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "editor",
          include: ["tests/unit/editor/**/*.test.ts"],
          environment: "happy-dom",
          // Unit tests make no network request: happy-dom must not fetch iframes, scripts or styles.
          environmentOptions: {
            happyDOM: {
              settings: {
                disableIframePageLoading: true,
                disableJavaScriptFileLoading: true,
                disableCSSFileLoading: true,
                navigation: { disableChildFrameNavigation: true, disableChildPageNavigation: true },
              },
            },
          },
        },
      },
    ],
  },
});
