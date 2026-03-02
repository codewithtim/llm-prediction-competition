import type { BetErrorCategory } from "../models/prediction";

const ERROR_PATTERNS: Array<{ pattern: RegExp; category: BetErrorCategory }> = [
  { pattern: /insufficient balance|not enough funds/i, category: "insufficient_funds" },
  { pattern: /timeout|ECONNREFUSED|ECONNRESET|socket hang up/i, category: "network_error" },
  { pattern: /429|rate limit/i, category: "rate_limited" },
  { pattern: /invalid signature|nonce/i, category: "wallet_error" },
  { pattern: /market not found|market closed/i, category: "invalid_market" },
];

export function classifyBetError(error: unknown): BetErrorCategory {
  const message = error instanceof Error ? error.message : String(error ?? "");

  for (const { pattern, category } of ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return category;
    }
  }

  return "unknown";
}
