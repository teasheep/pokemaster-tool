import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // 預設 timeout 5s; matcher 整合測試慢, 標記為 e2e 的個別調整
    testTimeout: 10_000,
  },
});
