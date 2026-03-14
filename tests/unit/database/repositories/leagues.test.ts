import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "../../../../src/database/client";
import { leaguesRepo, toLeagueConfig } from "../../../../src/database/repositories/leagues";
import * as schema from "../../../../src/database/schema";

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });
});

describe("leaguesRepo", () => {
  it("findEnabled returns only enabled leagues", async () => {
    const repo = leaguesRepo(db);
    const enabled = await repo.findEnabled();
    for (const league of enabled) {
      expect(league.enabled).toBe(true);
    }
    const ids = enabled.map((l) => l.id);
    expect(ids).toContain(39);
    expect(ids).toContain(2);
    expect(ids).toContain(40);
    expect(ids).not.toContain(140);
  });

  it("findEnabledBySport returns only football leagues that are enabled", async () => {
    const repo = leaguesRepo(db);
    const football = await repo.findEnabledBySport("football");
    expect(football.length).toBeGreaterThanOrEqual(1);
    for (const league of football) {
      expect(league.sport).toBe("football");
      expect(league.enabled).toBe(true);
    }
  });

  it("findEnabledBySport returns empty for unknown sport", async () => {
    const repo = leaguesRepo(db);
    const result = await repo.findEnabledBySport("cricket");
    expect(result).toHaveLength(0);
  });

  it("findAll returns all leagues regardless of enabled status", async () => {
    const repo = leaguesRepo(db);
    const all = await repo.findAll();
    expect(all.length).toBe(8);
    const disabled = all.filter((l) => !l.enabled);
    expect(disabled.length).toBeGreaterThan(0);
  });

  it("findById returns correct league", async () => {
    const repo = leaguesRepo(db);
    const pl = await repo.findById(39);
    expect(pl?.name).toBe("Premier League");
    expect(pl?.sport).toBe("football");
    expect(pl?.tier).toBe(1);
  });

  it("findById returns undefined for missing id", async () => {
    const repo = leaguesRepo(db);
    const missing = await repo.findById(99999);
    expect(missing).toBeUndefined();
  });

  it("setEnabled toggles the flag", async () => {
    const repo = leaguesRepo(db);
    await repo.setEnabled(39, false);
    const disabled = await repo.findById(39);
    expect(disabled?.enabled).toBe(false);

    await repo.setEnabled(39, true);
    const enabled = await repo.findById(39);
    expect(enabled?.enabled).toBe(true);
  });

  it("upsert creates new league", async () => {
    const repo = leaguesRepo(db);
    await repo.upsert({
      id: 999,
      sport: "football",
      name: "Test League",
      country: "Test",
      type: "league",
      polymarketSeriesSlug: "test-league",
      tier: 3,
      enabled: true,
    });
    const found = await repo.findById(999);
    expect(found?.name).toBe("Test League");
    expect(found?.tier).toBe(3);
  });

  it("upsert updates existing league on conflict", async () => {
    const repo = leaguesRepo(db);
    await repo.upsert({
      id: 39,
      sport: "football",
      name: "EPL",
      country: "England",
      type: "league",
      polymarketSeriesSlug: "premier-league",
      tier: 1,
      enabled: true,
    });
    const found = await repo.findById(39);
    expect(found?.name).toBe("EPL");
  });
});

describe("toLeagueConfig", () => {
  it("correctly maps DB row to LeagueConfig", async () => {
    const repo = leaguesRepo(db);
    const row = await repo.findById(2);
    expect(row).toBeDefined();
    const config = toLeagueConfig(row!);
    expect(config.id).toBe(2);
    expect(config.sport).toBe("football");
    expect(config.name).toBe("Champions League");
    expect(config.type).toBe("cup");
    expect(config.polymarketSeriesSlug).toBe("ucl");
    expect(config.domesticLeagueIds).toEqual([39, 140, 135, 78, 61]);
    expect(config.tier).toBe(1);
  });

  it("maps null domesticLeagueIds to undefined", async () => {
    const repo = leaguesRepo(db);
    const row = await repo.findById(39);
    expect(row).toBeDefined();
    const config = toLeagueConfig(row!);
    expect(config.domesticLeagueIds).toBeUndefined();
  });
});
