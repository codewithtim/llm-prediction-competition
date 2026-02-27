import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.error("TURSO_DATABASE_URL must be set");
  console.error("  Local:  TURSO_DATABASE_URL=file:local.db");
  console.error("  Remote: TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=...");
  process.exit(1);
}

const client = createClient({ url, authToken: authToken || undefined });

const db = drizzle(client);

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations complete");
process.exit(0);
