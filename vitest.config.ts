import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["tests/unit/**/*.test.ts"],
          exclude: ["tests/unit/editor/**"],
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
