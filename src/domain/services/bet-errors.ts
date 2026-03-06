import type { BetErrorCategory } from "../models/prediction";

const ERROR_PATTERNS: Array<{ pattern: RegExp; category: BetErrorCategory }> = [
  {
    pattern: /insufficient balance|not enough funds|not enough balance/i,
    category: "insufficient_funds",
  },
  { pattern: /timeout|ECONNREFUSED|ECONNRESET|socket hang up/i, category: "network_error" },
  { pattern: /429|rate limit/i, category: "rate_limited" },
  { pattern: /invalid signature|nonce/i, category: "wallet_error" },
  { pattern: /market not found|market closed/i, category: "invalid_market" },
  {
    pattern: /invalid amount.*min size|order size.*too small|below.*minimum/i,
    category: "order_too_small",
  },
  {
    pattern: /trading restricted in your region|refer to available regions/i,
    category: "geo_restricted",
  },
];

export function extractMinBetSize(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = message.match(/min size:\s*\$?([\d.]+)/i);
  if (!match?.[1]) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyBetError(error: unknown): BetErrorCategory {
  const message = error instanceof Error ? error.message : String(error ?? "");

  for (const { pattern, category } of ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return category;
    }
  }

  return "unknown";
}
