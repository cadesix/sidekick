import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be set to run migrations");
}

const client = postgres(connectionString, { max: 1 });
await migrate(drizzle(client), { migrationsFolder });
await client.end();

console.log("migrations applied");
