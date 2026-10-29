import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const clockRules = {
  "no-restricted-properties": [
    "error",
    { object: "Date", property: "now", message: "Read time from an injected Clock (constitution IV)." },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: "Read time from an injected Clock (constitution IV).",
    },
  ],
};

const literalAttrs = "aria-label|title|placeholder|alt";

export default tseslint.config(
  { ignores: ["node_modules/", "out/", "dist/", "test-results/", "playwright-report/", "specs/", ".specify/", ".claude/", "release/", "build/"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.node.json", "./tsconfig.web.json", "./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  {
    files: ["eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  // Clock: only the two clock modules read the system time.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/main/clock.ts", "src/renderer/clock.ts"],
    rules: clockRules,
  },
  // Domain stays pure (constitution IV).
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["electron", "react", "react-dom", "zustand", "better-sqlite3", "fs", "path", "os", "crypto"].map((name) => ({
            name,
            message: "src/domain must stay free of Electron, Node, DOM and UI imports (constitution IV).",
          })),
          patterns: [
            { group: ["node:*"], message: "No Node built-ins in src/domain (constitution IV)." },
            {
              group: ["**/main/**", "**/preload/**", "**/renderer/**"],
              message: "src/domain must not import other layers (constitution IV).",
            },
          ],
        },
      ],
    },
  },
  // 009 research §1: electron-log/main registers IPC listeners outside the contract and /renderer needs them;
  // the logger is electron-log/node only (constitution II).
  {
    files: ["src/main/**/*.ts", "src/preload/**/*.ts", "src/renderer/**/*.{ts,tsx}", "src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["electron-log", "electron-log/main", "electron-log/renderer", "electron-log/preload"].map((name) => ({
            name,
            message: "Use electron-log/node, through src/main/log.ts (009 research §1, constitution II).",
          })),
        },
      ],
    },
  },
  // Renderer: React hooks rules, and every visible string through t() (constitution V, FR-046).
  {
    files: ["src/renderer/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-syntax": [
        "error",
        ...clockRules["no-restricted-syntax"].slice(1),
        { selector: "JSXText[value=/\\S/]", message: "User-visible text must come from t() (FR-046)." },
        {
          selector: `JSXAttribute[name.name=/^(${literalAttrs})$/] > Literal`,
          message: "User-visible text must come from t() (FR-046).",
        },
      ],
    },
  },
  {
    files: ["src/renderer/clock.ts"],
    rules: { "no-restricted-properties": "off", "no-restricted-syntax": "off" },
  },
);
