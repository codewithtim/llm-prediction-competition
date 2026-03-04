import type { AdapterFactory } from "../../domain/types/notification.ts";
import { createDiscordAdapter } from "./adapters/discord.ts";

export const defaultAdapterFactories: Map<string, AdapterFactory> = new Map([
  ["discord", createDiscordAdapter],
]);
