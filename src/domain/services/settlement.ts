import type { GammaClient } from "../../apis/polymarket/gamma-client";
import { mapGammaMarketToMarket } from "../../apis/polymarket/mappers";
import type { AuditLogRepo } from "../../database/repositories/audit-log";
import type { betsRepo as betsRepoFactory } from "../../database/repositories/bets";
import type { marketsRepo as marketsRepoFactory } from "../../database/repositories/markets";

export type SettledBet = {
  betId: string;
  marketId: string;
  competitorId: string;
  side: "YES" | "NO";
  outcome: "won" | "lost";
  profit: number;
  marketQuestion: string;
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
  if (price <= 0 || !Number.isFinite(price)) {
    return -amount;
  }
  if (won) {
    return amount * ((1 - price) / price);
  }
  return -amount;
}

export function createSettlementService(deps: {
  gammaClient: GammaClient;
  betsRepo: ReturnType<typeof betsRepoFactory>;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
  auditLog: AuditLogRepo;
}) {
  const { gammaClient, betsRepo, marketsRepo, auditLog } = deps;

  return {
    async settleBets(): Promise<SettlementResult> {
      const settled: SettledBet[] = [];
      const errors: string[] = [];
      let skipped = 0;

      // Only settle pending and filled bets.
      // submitting and failed bets are excluded — they haven't been confirmed on-chain.
      const pendingBets = await betsRepo.findByStatus("pending");
      const filledBets = await betsRepo.findByStatus("filled");
      const unsettledBets = [...pendingBets, ...filledBets];

      if (unsettledBets.length === 0) {
        return { settled, skipped: 0, errors };
      }

      const marketIds = [...new Set(unsettledBets.map((b) => b.marketId))];

      const resolvedMarkets = new Map<
        string,
        { outcomePrices: [string, string]; question: string }
      >();

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
              resolvedMarkets.set(marketId, {
                outcomePrices: dbMarket.outcomePrices,
                question: dbMarket.question,
              });
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

          resolvedMarkets.set(marketId, {
            outcomePrices: mapped.outcomePrices,
            question: dbMarket.question,
          });

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
        const resolved = resolvedMarkets.get(bet.marketId);
        if (!resolved) continue;

        const winningOutcome = determineWinningOutcome(resolved.outcomePrices);
        if (!winningOutcome) continue;

        const won = bet.side === winningOutcome;
        const profit = calculateProfit(bet.amount, bet.price, won);

        try {
          const statusAfter = won ? "settled_won" : "settled_lost";
          await betsRepo.updateStatus(bet.id, statusAfter, new Date(), profit);

          await auditLog.safeRecord({
            betId: bet.id,
            event: "bet_settled",
            statusBefore: bet.status as "pending" | "filled",
            statusAfter,
            metadata: { outcome: won ? "won" : "lost", profit, winningSide: winningOutcome },
          });

          settled.push({
            betId: bet.id,
            marketId: bet.marketId,
            competitorId: bet.competitorId,
            side: bet.side as "YES" | "NO",
            outcome: won ? "won" : "lost",
            profit,
            marketQuestion: resolved.question,
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
