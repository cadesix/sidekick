import { defineConfig } from "tsup";

/**
 * Workspace packages ship raw TypeScript (`exports` points at `src`), so they must
 * be bundled in rather than left as runtime requires. Sourcemaps pair with
 * `node --enable-source-maps` in `start.sh` to keep Sentry stack traces readable.
 */
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  noExternal: [/^@sidekick\//],
  sourcemap: true,
  clean: true,
});
