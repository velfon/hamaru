import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * 依存方向(02 §2)を物理的に強制する。
 *   core  ←  config  ←  ui / telemetry / storage / sim / worker
 * `src/core` は同じディレクトリの相対 import 以外を一切使えない。
 */
const CORE_IMPORT_MESSAGE =
  "src/core は純粋ロジック層です。core の外(パッケージ・他ディレクトリ)を import できません(docs/02 §2)。";

const FORBIDDEN_CORE_GLOBALS = [
  "document",
  "window",
  "navigator",
  "localStorage",
  "sessionStorage",
  "location",
  "history",
  "fetch",
  "alert",
  "performance",
  "requestAnimationFrame",
  "setTimeout",
  "setInterval",
  "process",
  "crypto",
];

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "sim/out/**",
      "tests/unit/golden/*.json",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ["src/core/**/*.ts"],
    languageOptions: {
      // core はブラウザ / Node のグローバルを一切前提にしない。
      globals: {},
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ regex: "^(?!\\./)", message: CORE_IMPORT_MESSAGE }],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...FORBIDDEN_CORE_GLOBALS.map((name) => ({
          name,
          message: "src/core は DOM / 実行環境のグローバルを使えません(docs/02 §3)。",
        })),
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "src/core では Math.random() 禁止。core/rng.ts のシード付き乱数を使う。",
        },
        {
          object: "Date",
          property: "now",
          message: "src/core では Date.now() 禁止。現在時刻は引数 `now` で渡す(docs/02 §3)。",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "src/core では現在時刻を読めません。`new Date(ms)` のように引数で渡す。",
        },
      ],
    },
  },
  {
    files: ["sim/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
);
