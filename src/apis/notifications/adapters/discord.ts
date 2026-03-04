import type {
  FailedBetNotification,
  IterationFailureNotification,
  IterationNotification,
  NotificationAdapter,
  NotificationEvent,
  PlacedBetNotification,
  SettledBetNotification,
} from "../../../domain/types/notification.ts";
import { logger } from "../../../shared/logger.ts";

type DiscordEmbed = {
  title: string;
  description?: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
};

type DiscordPayload = {
  username: string;
  embeds: DiscordEmbed[];
};

const BOT_NAME = "LLM Betting Bot";
const COLOR_GREEN = 0x00c853;
const COLOR_RED = 0xf44336;
const COLOR_PURPLE = 0x9c27b0;

function formatBetsPlaced(bets: PlacedBetNotification[]): DiscordPayload {
  return {
    username: BOT_NAME,
    embeds: [
      {
        title: "Bets Placed",
        color: COLOR_GREEN,
        fields: bets.map((b) => ({
          name: `${b.fixtureLabel} — ${b.marketQuestion}`,
          value: `${b.side} @ $${b.price.toFixed(2)} — $${b.amount.toFixed(2)} stake (${b.competitorId})`,
        })),
        footer: { text: `${bets.length} bet${bets.length === 1 ? "" : "s"} placed` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function formatBetsFailed(bets: FailedBetNotification[]): DiscordPayload {
  return {
    username: BOT_NAME,
    embeds: [
      {
        title: "Bets Failed",
        color: COLOR_RED,
        fields: bets.map((b) => ({
          name: `${b.fixtureLabel} — ${b.marketQuestion}`,
          value: `${b.side} — $${b.amount.toFixed(2)} stake — ${b.error} (${b.competitorId})`,
        })),
        footer: { text: `${bets.length} bet${bets.length === 1 ? "" : "s"} failed` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function formatBetsSettled(bets: SettledBetNotification[]): DiscordPayload {
  const netPnl = bets.reduce((sum, b) => sum + b.profit, 0);
  const color = netPnl >= 0 ? COLOR_GREEN : COLOR_RED;

  return {
    username: BOT_NAME,
    embeds: [
      {
        title: "Bets Settled",
        color,
        fields: bets.map((b) => ({
          name: b.marketQuestion,
          value: `${b.outcome === "won" ? "Won" : "Lost"} — ${b.side} — ${b.profit >= 0 ? "+" : ""}$${b.profit.toFixed(2)} (${b.competitorId})`,
        })),
        footer: {
          text: `Net P&L: ${netPnl >= 0 ? "+" : ""}$${netPnl.toFixed(2)} — ${bets.length} bet${bets.length === 1 ? "" : "s"}`,
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function formatIteration(
  successes: IterationNotification[],
  failures: IterationFailureNotification[],
): DiscordPayload {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  for (const s of successes) {
    fields.push({
      name: s.competitorName,
      value: `v${s.version} — ${s.model}`,
      inline: true,
    });
  }

  for (const f of failures) {
    fields.push({
      name: `${f.competitorName} (FAILED)`,
      value: f.error,
    });
  }

  return {
    username: BOT_NAME,
    embeds: [
      {
        title: "Model Iteration",
        color: failures.length > 0 ? COLOR_RED : COLOR_PURPLE,
        fields,
        footer: {
          text: `${successes.length} succeeded, ${failures.length} failed`,
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function formatEvent(event: NotificationEvent): DiscordPayload | null {
  switch (event.type) {
    case "bets_placed":
      return formatBetsPlaced(event.bets);
    case "bets_failed":
      return formatBetsFailed(event.bets);
    case "bets_settled":
      return formatBetsSettled(event.bets);
    case "iteration_complete":
      return formatIteration(event.successes, event.failures);
  }
}

export function createDiscordAdapter(config: Record<string, string>): NotificationAdapter {
  const webhookUrl = config.webhookUrl;
  if (!webhookUrl) throw new Error("Discord adapter requires webhookUrl in config");

  return {
    async send(event: NotificationEvent): Promise<void> {
      const payload = formatEvent(event);
      if (!payload) return;

      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          logger.error("Discord webhook failed", { status: res.status, detail });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("Discord webhook request failed", { error: msg });
      }
    },
  };
}
