import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/core/**/*.ts", "src/config/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        // 06 §2 / G2: src/core は行 95 % 以上。
        "src/core/**": { lines: 95 },
      },
    },
  },
});
