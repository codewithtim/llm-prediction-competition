export type PredictionSide = "YES" | "NO";

export type Prediction = {
  marketId: string;
  fixtureId: number;
  competitorId: string;
  side: PredictionSide;
  confidence: number;
  stake: number;
  reasoning: string;
  createdAt: string;
};

export type BetErrorCategory =
  | "insufficient_funds"
  | "network_error"
  | "rate_limited"
  | "wallet_error"
  | "invalid_market"
  | "order_too_small"
  | "unknown";

export type Bet = {
  id: string;
  orderId: string | null;
  marketId: string;
  fixtureId: number;
  competitorId: string;
  tokenId: string;
  side: PredictionSide;
  amount: number;
  price: number;
  shares: number;
  status: BetStatus;
  placedAt: string;
  settledAt: string | null;
  profit: number | null;
  errorMessage: string | null;
  errorCategory: BetErrorCategory | null;
  attempts: number;
  lastAttemptAt: string | null;
};

export type BetStatus =
  | "submitting"
  | "pending"
  | "filled"
  | "settled_won"
  | "settled_lost"
  | "cancelled"
  | "failed";

/** Bet statuses that represent capital in flight — used for duplicate prevention and exposure checks. */
export const ACTIVE_BET_STATUSES = [
  "submitting",
  "pending",
  "filled",
] as const satisfies BetStatus[];
