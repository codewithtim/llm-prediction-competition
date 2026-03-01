import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { loadCompetitors } from "../../../src/competitors/loader";
import type { Database } from "../../../src/infrastructure/database/client";
import { competitorsRepo } from "../../../src/infrastructure/database/repositories/competitors";
import { walletsRepo } from "../../../src/infrastructure/database/repositories/wallets";
import * as schema from "../../../src/infrastructure/database/schema";

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });
});

describe("loadCompetitors", () => {
  it("loads weight-tuned competitors", async () => {
    const repo = competitorsRepo(db);

    const engines = await loadCompetitors({
      competitorsRepo: repo,
      walletsRepo: walletsRepo(db),
      encryptionKey: "",
    });

    // All weight-tuned competitors should load
    const wtEngines = engines.filter((e) => e.competitorId.startsWith("wt-"));
    expect(wtEngines.length).toBeGreaterThan(0);
    for (const e of wtEngines) {
      expect(typeof e.engine).toBe("function");
    }
  });

  it("does not load disabled competitors", async () => {
    const repo = competitorsRepo(db);
    await repo.setStatus("wt-claude-sonnet", "disabled");

    const engines = await loadCompetitors({
      competitorsRepo: repo,
      walletsRepo: walletsRepo(db),
      encryptionKey: "",
    });

    const ids = engines.map((e) => e.competitorId);
    expect(ids).not.toContain("wt-claude-sonnet");
  });

  it("sets competitor status to error on load failure", async () => {
    const repo = competitorsRepo(db);

    // Insert a competitor with an unknown type to trigger load error
    await repo.create({
      id: "bad-type",
      name: "Bad Type",
      model: "test",
      type: "unknown-type",
      status: "active",
      enginePath: null,
    });

    await loadCompetitors({
      competitorsRepo: repo,
      walletsRepo: walletsRepo(db),
      encryptionKey: "",
    });

    const updated = await repo.findById("bad-type");
    expect(updated?.status).toBe("error");
  });
});
