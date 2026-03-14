import crypto from "node:crypto";
import type {
  NotificationAdapter,
  NotificationEvent,
  PlacedBetNotification,
  SettledBetNotification,
  WeeklySummaryNotification,
} from "../../../domain/types/notification.ts";
import { env } from "../../../shared/env.ts";
import { logger } from "../../../shared/logger.ts";

const TWITTER_API_URL = "https://api.twitter.com/2/tweets";
const MAX_TWEET_LENGTH = 280;

type TwitterCredentials = {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

function truncate(text: string): string {
  if (text.length <= MAX_TWEET_LENGTH) return text;
  return `${text.slice(0, MAX_TWEET_LENGTH - 1)}…`;
}

function formatPlacedBet(bet: PlacedBetNotification): string {
  return truncate(
    `🎯 New bet placed!\n\n${bet.fixtureLabel}\n${bet.marketQuestion}\n\n${bet.side} @ ${bet.price.toFixed(2)} — $${bet.amount.toFixed(2)} stake\nModel: ${bet.competitorId}`,
  );
}

function formatSettledBet(bet: SettledBetNotification): string {
  const pnl =
    bet.profit >= 0 ? `+$${bet.profit.toFixed(2)}` : `-$${Math.abs(bet.profit).toFixed(2)}`;
  if (bet.outcome === "won") {
    return truncate(
      `✅ Bet won!\n\n${bet.marketQuestion}\n${bet.side} — $${bet.amount.toFixed(2)} stake — ${pnl}\nModel: ${bet.competitorId}`,
    );
  }
  return truncate(
    `❌ Bet lost.\n\n${bet.marketQuestion}\n${bet.side} — $${bet.amount.toFixed(2)} stake — ${pnl}\nModel: ${bet.competitorId}`,
  );
}

function formatWeeklySummary(summary: WeeklySummaryNotification): string {
  const pnl =
    summary.netPnl >= 0
      ? `+$${summary.netPnl.toFixed(2)}`
      : `-$${Math.abs(summary.netPnl).toFixed(2)}`;
  const winRate = (summary.winRate * 100).toFixed(1);
  const topLine = summary.topCompetitor
    ? `\n\nTop model: ${summary.topCompetitor.name} (${summary.topCompetitor.pnl >= 0 ? "+" : ""}$${summary.topCompetitor.pnl.toFixed(2)})`
    : "";
  return truncate(
    `📊 Weekly Update\n\n${summary.totalBetsPlaced} bets placed\n${summary.wins}W - ${summary.losses}L (${winRate}%)\nP&L: ${pnl}${topLine}\n${summary.upcomingFixtures} fixtures ahead`,
  );
}

export function formatTweet(event: NotificationEvent): string[] | null {
  switch (event.type) {
    case "bets_placed":
      return event.bets.map(formatPlacedBet);
    case "bets_settled":
      return event.bets.map(formatSettledBet);
    case "weekly_summary":
      return [formatWeeklySummary(event.summary)];
    case "bets_failed":
    case "iteration_complete":
      return null;
  }
}

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

function buildOAuthHeader(credentials: TwitterCredentials, method: string, url: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();

  const params: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };

  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k] ?? "")}`)
    .join("&");

  const signatureBase = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(credentials.consumerSecret)}&${percentEncode(credentials.accessTokenSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(signatureBase).digest("base64");

  params.oauth_signature = signature;

  const header = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(params[k] ?? "")}"`)
    .join(", ");

  return `OAuth ${header}`;
}

async function postTweet(text: string, credentials: TwitterCredentials): Promise<void> {
  const authHeader = buildOAuthHeader(credentials, "POST", TWITTER_API_URL);

  const res = await fetch(TWITTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    logger.error("Twitter API failed", { status: res.status, detail });
  }
}

export function createTwitterAdapter(
  _config: Record<string, string>,
  credentialsOverride?: TwitterCredentials,
): NotificationAdapter {
  const credentials: TwitterCredentials = credentialsOverride ?? {
    consumerKey: env.TWITTER_CONSUMER_KEY,
    consumerSecret: env.TWITTER_CONSUMER_SECRET,
    accessToken: env.TWITTER_ACCESS_TOKEN,
    accessTokenSecret: env.TWITTER_ACCESS_TOKEN_SECRET,
  };

  const hasCredentials =
    credentials.consumerKey &&
    credentials.consumerSecret &&
    credentials.accessToken &&
    credentials.accessTokenSecret;

  return {
    async send(event: NotificationEvent): Promise<void> {
      if (!hasCredentials) {
        logger.debug("Twitter adapter skipped — no credentials configured");
        return;
      }

      const tweets = formatTweet(event);
      if (!tweets) return;

      for (const text of tweets) {
        try {
          await postTweet(text, credentials);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("Twitter post failed", { error: msg });
        }
      }
    },
  };
}
