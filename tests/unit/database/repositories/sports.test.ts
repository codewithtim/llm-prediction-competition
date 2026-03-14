import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "../../../../src/database/client";
import { sportsRepo } from "../../../../src/database/repositories/sports";
import * as schema from "../../../../src/database/schema";

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });
});

describe("sportsRepo", () => {
  it("findEnabled returns only enabled sports", async () => {
    const repo = sportsRepo(db);
    const enabled = await repo.findEnabled();
    expect(enabled.length).toBeGreaterThanOrEqual(1);
    for (const sport of enabled) {
      expect(sport.enabled).toBe(true);
    }
  });

  it("findAll returns all sports", async () => {
    const repo = sportsRepo(db);
    const all = await repo.findAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.find((s) => s.slug === "football")).toBeDefined();
  });

  it("findBySlug returns correct sport", async () => {
    const repo = sportsRepo(db);
    const football = await repo.findBySlug("football");
    expect(football).toBeDefined();
    expect(football?.name).toBe("Football");
    expect(football?.polymarketTagId).toBe(100350);
  });

  it("findBySlug returns undefined for missing slug", async () => {
    const repo = sportsRepo(db);
    const missing = await repo.findBySlug("cricket");
    expect(missing).toBeUndefined();
  });

  it("upsert creates new sport", async () => {
    const repo = sportsRepo(db);
    await repo.upsert({
      slug: "basketball",
      name: "Basketball",
      polymarketTagId: 200000,
      enabled: true,
    });
    const found = await repo.findBySlug("basketball");
    expect(found?.name).toBe("Basketball");
    expect(found?.polymarketTagId).toBe(200000);
  });

  it("upsert updates existing sport on conflict", async () => {
    const repo = sportsRepo(db);
    await repo.upsert({
      slug: "football",
      name: "Soccer",
      polymarketTagId: 999,
      enabled: false,
    });
    const found = await repo.findBySlug("football");
    expect(found?.name).toBe("Soccer");
    expect(found?.polymarketTagId).toBe(999);
  });
});
