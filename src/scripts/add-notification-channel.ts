/**
 * Add Notification Channel — manages notification channels in the database.
 *
 * Usage:
 *   bun run src/scripts/add-notification-channel.ts --type discord --name "Main Discord" --config '{"webhookUrl":"https://..."}'
 *   bun run src/scripts/add-notification-channel.ts --list
 *   bun run src/scripts/add-notification-channel.ts --disable <id>
 *   bun run src/scripts/add-notification-channel.ts --enable <id>
 */

import type { NotificationChannelsRepo } from "../database/repositories/notification-channels";

type AddChannelParams = {
  action: "add";
  name: string;
  type: string;
  config: Record<string, string>;
};

type ListParams = {
  action: "list";
};

type ToggleParams = {
  action: "enable" | "disable";
  id: number;
};

type ParsedArgs = AddChannelParams | ListParams | ToggleParams | null;

export function parseArgs(args: string[]): ParsedArgs {
  if (args.includes("--list")) {
    return { action: "list" };
  }

  const enableIdx = args.indexOf("--enable");
  const enableArg = enableIdx !== -1 ? args[enableIdx + 1] : undefined;
  if (enableArg) {
    const id = Number.parseInt(enableArg, 10);
    if (Number.isNaN(id)) return null;
    return { action: "enable", id };
  }

  const disableIdx = args.indexOf("--disable");
  const disableArg = disableIdx !== -1 ? args[disableIdx + 1] : undefined;
  if (disableArg) {
    const id = Number.parseInt(disableArg, 10);
    if (Number.isNaN(id)) return null;
    return { action: "disable", id };
  }

  const typeIdx = args.indexOf("--type");
  const nameIdx = args.indexOf("--name");
  const configIdx = args.indexOf("--config");

  const type = typeIdx !== -1 ? args[typeIdx + 1] : undefined;
  const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined;
  const configStr = configIdx !== -1 ? args[configIdx + 1] : undefined;

  if (!type || !name || !configStr) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(configStr);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.some(([, v]) => typeof v !== "string")) return null;
  const config = parsed as Record<string, string>;

  return { action: "add", name, type, config };
}

export async function runCommand(repo: NotificationChannelsRepo, parsed: NonNullable<ParsedArgs>) {
  switch (parsed.action) {
    case "list": {
      const channels = await repo.findAll();
      if (channels.length === 0) {
        console.log("No notification channels configured.");
        return;
      }
      for (const ch of channels) {
        const status = ch.enabled ? "enabled" : "disabled";
        console.log(`  [${ch.id}] ${ch.name} (${ch.type}) — ${status}`);
      }
      return;
    }
    case "enable": {
      await repo.update(parsed.id, { enabled: true });
      console.log(`Channel ${parsed.id} enabled.`);
      return;
    }
    case "disable": {
      await repo.update(parsed.id, { enabled: false });
      console.log(`Channel ${parsed.id} disabled.`);
      return;
    }
    case "add": {
      await repo.create({
        name: parsed.name,
        type: parsed.type as "discord",
        config: parsed.config,
      });
      console.log(`Channel "${parsed.name}" (${parsed.type}) created.`);
      return;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (!parsed) {
    console.error("Usage:");
    console.error('  --type <type> --name <name> --config \'{"key":"value"}\'  Add a channel');
    console.error("  --list                                                   List all channels");
    console.error("  --enable <id>                                            Enable a channel");
    console.error("  --disable <id>                                           Disable a channel");
    process.exit(1);
  }

  const { createDb } = await import("../database/client");
  const { notificationChannelsRepo } = await import(
    "../database/repositories/notification-channels"
  );
  const { env } = await import("../shared/env");

  const db = createDb(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  const repo = notificationChannelsRepo(db);

  await runCommand(repo, parsed);
}

const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === Bun.pathToFileURL(process.argv[1] ?? "").href;
if (isMainModule) {
  main().catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
}
