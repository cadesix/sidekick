import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Database } from "./index";
import * as schema from "./schema";

/**
 * Production database handle, backed by postgres-js. Never used in tests.
 *
 * Sized for one long-lived Node process (Railway), not a fleet of lambdas: a
 * modest pool that every request shares, held open between requests. `max` stays
 * well under a small Postgres plan's connection ceiling so a second replica or a
 * `psql` session can still connect. `idle_timeout` returns connections the app
 * stopped needing overnight; `connect_timeout` turns an unreachable database into
 * a fast error the health check reports rather than a request that hangs forever.
 */
export function createDb(connectionString: string): Database {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
}
