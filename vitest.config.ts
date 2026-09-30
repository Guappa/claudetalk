import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      // Every source file counts, loaded by a test or not: a file no test imports is the one most worth seeing at zero.
      include: ["src/**/*.ts"],
      reporter: ["text-summary", "json-summary"],
    },
  },
});
