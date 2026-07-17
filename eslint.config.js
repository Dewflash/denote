import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // `.claude/` holds agent-session scratch (including throwaway git worktrees that duplicate the
  // whole repo); linting it double-reports every file and confuses the typed parser's rootDir.
  { ignores: ["dist", "src-tauri/target", "sidecar/apple-ai/.build", ".claude"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Domain-purity boundary (CLAUDE.md hard rule): src/domain is pure TS —
    // no services/state/app/features, no react, no @tauri-apps/*.
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/services/**",
                "**/services",
                "**/state/**",
                "**/state",
                "**/app/**",
                "**/app",
                "**/features/**",
                "**/features",
                "react",
                "react/**",
                "react-dom",
                "react-dom/**",
                "@tauri-apps/*",
              ],
              message:
                "src/domain must stay pure TypeScript — no services/state/app/features, react, or @tauri-apps imports.",
            },
          ],
        },
      ],
    },
  },
);
