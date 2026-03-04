import type { bets } from "../database/schema";
import type { BetSummary } from "../shared/api-types";

type BetRow = typeof bets.$inferSelect;

export type BetLookups = {
  competitorMap: Map<string, string>;
  marketById: Map<string, { question: string; polymarketUrl: string | null }>;
  predictionMap: Map<string, number>;
};

export function toBetSummary(b: BetRow, lookups: BetLookups): BetSummary {
  const market = lookups.marketById.get(b.marketId);
  return {
    id: b.id,
    competitorId: b.competitorId,
    competitorName: lookups.competitorMap.get(b.competitorId) ?? "Unknown",
    marketId: b.marketId,
    marketQuestion: market?.question ?? "Unknown",
    polymarketUrl: market?.polymarketUrl ?? null,
    fixtureId: b.fixtureId,
    side: b.side,
    amount: b.amount,
    price: b.price,
    shares: b.shares,
    status: b.status,
    placedAt: b.placedAt?.toISOString() ?? "",
    settledAt: b.settledAt?.toISOString() ?? null,
    profit: b.profit,
    confidence: lookups.predictionMap.get(`${b.competitorId}:${b.marketId}:${b.side}`) ?? null,
    errorMessage: b.errorMessage ?? null,
    errorCategory: b.errorCategory ?? null,
    attempts: b.attempts ?? 0,
  };
}
