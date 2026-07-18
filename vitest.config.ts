import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Several suites intentionally exercise the same persistent SQLite module.
    // Keep test files in one process so their WAL setup cannot race in CI.
    fileParallelism: false,
  },
});
