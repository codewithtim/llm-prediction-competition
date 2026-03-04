import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "../../../src/database/client";
import { notificationChannelsRepo } from "../../../src/database/repositories/notification-channels";
import * as schema from "../../../src/database/schema";
import { parseArgs, runCommand } from "../../../src/scripts/add-notification-channel";

let db: Database;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  db = drizzle(client, { schema }) as Database;
  await migrate(db, { migrationsFolder: "./drizzle" });
});

describe("parseArgs", () => {
  it("parses --list", () => {
    expect(parseArgs(["--list"])).toEqual({ action: "list" });
  });

  it("parses --enable with valid id", () => {
    expect(parseArgs(["--enable", "3"])).toEqual({ action: "enable", id: 3 });
  });

  it("returns null for --enable with non-numeric id", () => {
    expect(parseArgs(["--enable", "abc"])).toBeNull();
  });

  it("parses --disable with valid id", () => {
    expect(parseArgs(["--disable", "7"])).toEqual({ action: "disable", id: 7 });
  });

  it("returns null for --disable with non-numeric id", () => {
    expect(parseArgs(["--disable", "xyz"])).toBeNull();
  });

  it("parses add with --type, --name, --config", () => {
    const result = parseArgs([
      "--type",
      "discord",
      "--name",
      "Main Discord",
      "--config",
      '{"webhookUrl":"https://example.com"}',
    ]);
    expect(result).toEqual({
      action: "add",
      name: "Main Discord",
      type: "discord",
      config: { webhookUrl: "https://example.com" },
    });
  });

  it("returns null when --type is missing", () => {
    expect(
      parseArgs(["--name", "Main", "--config", '{"webhookUrl":"https://example.com"}']),
    ).toBeNull();
  });

  it("returns null when --name is missing", () => {
    expect(
      parseArgs(["--type", "discord", "--config", '{"webhookUrl":"https://example.com"}']),
    ).toBeNull();
  });

  it("returns null when --config is missing", () => {
    expect(parseArgs(["--type", "discord", "--name", "Main"])).toBeNull();
  });

  it("returns null for invalid JSON in --config", () => {
    expect(parseArgs(["--type", "discord", "--name", "Main", "--config", "not-json"])).toBeNull();
  });

  it("returns null when config is an array", () => {
    expect(parseArgs(["--type", "discord", "--name", "Main", "--config", "[1,2,3]"])).toBeNull();
  });

  it("returns null when config has non-string values", () => {
    expect(
      parseArgs(["--type", "discord", "--name", "Main", "--config", '{"webhookUrl":123}']),
    ).toBeNull();
  });

  it("returns null for empty args", () => {
    expect(parseArgs([])).toBeNull();
  });
});

describe("runCommand", () => {
  it("creates a channel via add action", async () => {
    const repo = notificationChannelsRepo(db);
    await runCommand(repo, {
      action: "add",
      name: "Test Discord",
      type: "discord",
      config: { webhookUrl: "https://example.com/webhook" },
    });

    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("Test Discord");
    expect(all[0]?.type).toBe("discord");
    expect(all[0]?.enabled).toBe(true);
  });

  it("lists channels", async () => {
    const repo = notificationChannelsRepo(db);
    await repo.create({
      name: "Ch1",
      type: "discord",
      config: { webhookUrl: "https://example.com" },
    });

    const consoleSpy = mock(() => {});
    const origLog = console.log;
    console.log = consoleSpy;
    try {
      await runCommand(repo, { action: "list" });
    } finally {
      console.log = origLog;
    }

    expect(consoleSpy).toHaveBeenCalled();
    const output = (consoleSpy.mock.calls as unknown[][]).map((c) => c[0]).join("\n");
    expect(output).toContain("Ch1");
    expect(output).toContain("discord");
  });

  it("enables and disables a channel", async () => {
    const repo = notificationChannelsRepo(db);
    await repo.create({
      name: "Ch1",
      type: "discord",
      config: { webhookUrl: "https://example.com" },
    });

    const all = await repo.findAll();
    const id = all[0]!.id;

    await runCommand(repo, { action: "disable", id });
    const afterDisable = await repo.findById(id);
    expect(afterDisable?.enabled).toBe(false);

    await runCommand(repo, { action: "enable", id });
    const afterEnable = await repo.findById(id);
    expect(afterEnable?.enabled).toBe(true);
  });
});
