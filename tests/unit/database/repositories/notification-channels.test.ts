import { beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "../../../../src/database/client";
import { notificationChannelsRepo } from "../../../../src/database/repositories/notification-channels";
import * as schema from "../../../../src/database/schema";

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });
});

describe("notificationChannelsRepo", () => {
  it("creates a channel and retrieves it", async () => {
    const repo = notificationChannelsRepo(db);
    await repo.create({
      name: "Test Discord",
      type: "discord",
      config: { webhookUrl: "https://discord.com/api/webhooks/123/abc" },
    });

    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("Test Discord");
    expect(all[0]?.type).toBe("discord");
    expect(all[0]?.config).toEqual({ webhookUrl: "https://discord.com/api/webhooks/123/abc" });
    expect(all[0]?.enabled).toBe(true);
  });

  it("findEnabled only returns enabled channels", async () => {
    const repo = notificationChannelsRepo(db);
    await repo.create({
      name: "Enabled Channel",
      type: "discord",
      config: { webhookUrl: "https://discord.com/api/webhooks/1/a" },
      enabled: true,
    });
    await repo.create({
      name: "Disabled Channel",
      type: "discord",
      config: { webhookUrl: "https://discord.com/api/webhooks/2/b" },
      enabled: false,
    });

    const enabled = await repo.findEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.name).toBe("Enabled Channel");
  });

  it("update toggles enabled flag", async () => {
    const repo = notificationChannelsRepo(db);
    await repo.create({
      name: "My Channel",
      type: "discord",
      config: { webhookUrl: "https://discord.com/api/webhooks/1/a" },
    });

    const all = await repo.findAll();
    const id = all[0]!.id;

    await repo.update(id, { enabled: false });
    const updated = await repo.findById(id);
    expect(updated?.enabled).toBe(false);

    await repo.update(id, { enabled: true });
    const restored = await repo.findById(id);
    expect(restored?.enabled).toBe(true);
  });

  it("findById returns undefined for missing id", async () => {
    const repo = notificationChannelsRepo(db);
    const found = await repo.findById(999);
    expect(found).toBeUndefined();
  });
});
