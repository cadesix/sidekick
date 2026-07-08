import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "web/**", "apps/mobile/**"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
