import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export * from "./schema";
export { schema };

/**
 * Driver-agnostic database handle. Both the production postgres-js client
 * (`createDb`) and the PGlite test client (`createTestDb`) are assignable to
 * this, so application and test code depend on one type.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
