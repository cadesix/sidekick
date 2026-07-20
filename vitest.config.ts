import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 20_000,
    /**
     * The server validates its environment at boot (`readEnv`), so anything that
     * builds the Hono app needs the required vars present. Tests talk to PGlite
     * and scripted models, so these values are never dialled — they only have to
     * satisfy the schema.
     */
    env: {
      DATABASE_URL: "postgres://localhost:5432/sidekick-test",
      OPENAI_API_KEY: "test-openai-key",
      LOG_LEVEL: "silent",
    },
  },
});
