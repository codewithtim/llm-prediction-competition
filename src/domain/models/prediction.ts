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

export type Bet = {
  id: string;
  orderId: string;
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
};

export type BetStatus = "pending" | "filled" | "settled_won" | "settled_lost" | "cancelled";
