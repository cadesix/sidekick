import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Database } from "./index";
import * as schema from "./schema";

/** Production database handle, backed by postgres-js. Never used in tests. */
export function createDb(connectionString: string): Database {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}
