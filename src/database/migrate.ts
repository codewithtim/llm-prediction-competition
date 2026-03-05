import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { fixMigrationJournal } from "../scripts/fix-migration-journal";

// Fix any out-of-order or future timestamps before migrating.
// This prevents the silent-skip bug where Drizzle skips migrations
// whose `when` timestamp is before an already-applied migration.
fixMigrationJournal();

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
