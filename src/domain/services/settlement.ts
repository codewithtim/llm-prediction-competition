import type { betsRepo as betsRepoFactory } from "../../infrastructure/database/repositories/bets";
import type { marketsRepo as marketsRepoFactory } from "../../infrastructure/database/repositories/markets";
import type { GammaClient } from "../../infrastructure/polymarket/gamma-client";
import { mapGammaMarketToMarket } from "../../infrastructure/polymarket/mappers";

export type SettledBet = {
  betId: string;
  marketId: string;
  competitorId: string;
  side: "YES" | "NO";
  outcome: "won" | "lost";
  profit: number;
};

export type SettlementResult = {
  settled: SettledBet[];
  skipped: number;
  errors: string[];
};

export function determineWinningOutcome(outcomePrices: [string, string]): "YES" | "NO" | null {
  const yesPrice = Number.parseFloat(outcomePrices[0]);
  const noPrice = Number.parseFloat(outcomePrices[1]);
  if (yesPrice >= 0.99) return "YES";
  if (noPrice >= 0.99) return "NO";
  return null;
}

export function calculateProfit(amount: number, price: number, won: boolean): number {
  if (won) {
    return amount * ((1 - price) / price);
  }
  return -amount;
}

export function createSettlementService(deps: {
  gammaClient: GammaClient;
  betsRepo: ReturnType<typeof betsRepoFactory>;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
}) {
  const { gammaClient, betsRepo, marketsRepo } = deps;

  return {
    async settleBets(): Promise<SettlementResult> {
      const settled: SettledBet[] = [];
      const errors: string[] = [];
      let skipped = 0;

      const pendingBets = await betsRepo.findByStatus("pending");
      const filledBets = await betsRepo.findByStatus("filled");
      const unsettledBets = [...pendingBets, ...filledBets];

      if (unsettledBets.length === 0) {
        return { settled, skipped: 0, errors };
      }

      const marketIds = [...new Set(unsettledBets.map((b) => b.marketId))];

      const resolvedMarkets = new Map<string, [string, string]>();

      for (const marketId of marketIds) {
        try {
          const dbMarket = await marketsRepo.findById(marketId);
          if (!dbMarket) {
            errors.push(`Market ${marketId} not found in database`);
            continue;
          }

          if (dbMarket.closed) {
            const outcome = determineWinningOutcome(dbMarket.outcomePrices);
            if (outcome) {
              resolvedMarkets.set(marketId, dbMarket.outcomePrices);
            }
            continue;
          }

          const gammaMarket = await gammaClient.getMarketById(marketId);
          if (!gammaMarket) {
            skipped++;
            continue;
          }

          if (!gammaMarket.closed) {
            skipped++;
            continue;
          }

          const mapped = mapGammaMarketToMarket(gammaMarket);
          if (!mapped) {
            skipped++;
            continue;
          }

          const outcome = determineWinningOutcome(mapped.outcomePrices);
          if (!outcome) {
            skipped++;
            continue;
          }

          resolvedMarkets.set(marketId, mapped.outcomePrices);

          await marketsRepo.upsert({
            ...dbMarket,
            outcomePrices: mapped.outcomePrices,
            closed: true,
            active: false,
            acceptingOrders: false,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Error checking market ${marketId}: ${msg}`);
        }
      }

      for (const bet of unsettledBets) {
        const outcomePrices = resolvedMarkets.get(bet.marketId);
        if (!outcomePrices) continue;

        const winningOutcome = determineWinningOutcome(outcomePrices);
        if (!winningOutcome) continue;

        const won = bet.side === winningOutcome;
        const profit = calculateProfit(bet.amount, bet.price, won);

        try {
          await betsRepo.updateStatus(
            bet.id,
            won ? "settled_won" : "settled_lost",
            new Date(),
            profit,
          );

          settled.push({
            betId: bet.id,
            marketId: bet.marketId,
            competitorId: bet.competitorId,
            side: bet.side as "YES" | "NO",
            outcome: won ? "won" : "lost",
            profit,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Error settling bet ${bet.id}: ${msg}`);
        }
      }

      return { settled, skipped, errors };
    },
  };
}

export type SettlementService = ReturnType<typeof createSettlementService>;
