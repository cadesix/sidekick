import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "packages/web/**", "packages/expo/**"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
