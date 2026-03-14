import type { BettingClientFactory } from "../apis/polymarket/betting-client-factory.ts";
import {
  createRedemptionClient as defaultCreateRedemptionClient,
  type RedemptionClient,
} from "../apis/polymarket/redemption-client.ts";
import type { AuditLogRepo } from "../database/repositories/audit-log.ts";
import type { betsRepo as betsRepoFactory } from "../database/repositories/bets.ts";
import type { marketsRepo as marketsRepoFactory } from "../database/repositories/markets.ts";
import type { WalletConfig } from "../domain/types/competitor.ts";
import { logger } from "../shared/logger.ts";

export type RedemptionPipelineDeps = {
  betsRepo: ReturnType<typeof betsRepoFactory>;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
  bettingClientFactory: BettingClientFactory;
  auditLog: AuditLogRepo;
  walletConfigs: Map<string, WalletConfig>;
  createRedemptionClient?: (privateKey: string) => RedemptionClient;
};

export type RedemptionPipelineResult = {
  redeemed: number;
  skipped: number;
  errors: string[];
};

export function createRedemptionPipeline(deps: RedemptionPipelineDeps) {
  const {
    betsRepo,
    marketsRepo,
    bettingClientFactory,
    auditLog,
    walletConfigs,
    createRedemptionClient = defaultCreateRedemptionClient,
  } = deps;

  return {
    async run(): Promise<RedemptionPipelineResult> {
      const result: RedemptionPipelineResult = { redeemed: 0, skipped: 0, errors: [] };

      const unredeemedBets = await betsRepo.findUnredeemedWins();
      if (unredeemedBets.length === 0) return result;

      logger.info("Redemption: found unredeemed wins", { count: unredeemedBets.length });

      const marketIds = [...new Set(unredeemedBets.map((b) => b.marketId))];
      const marketList = await marketsRepo.findByIds(marketIds);
      const marketById = new Map(marketList.map((m) => [m.id, m]));

      const negRiskCache = new Map<string, boolean>();

      const betsByCompetitor = new Map<string, typeof unredeemedBets>();
      for (const bet of unredeemedBets) {
        const existing = betsByCompetitor.get(bet.competitorId) ?? [];
        existing.push(bet);
        betsByCompetitor.set(bet.competitorId, existing);
      }

      for (const [competitorId, competitorBets] of betsByCompetitor) {
        const walletConfig = walletConfigs.get(competitorId);
        if (!walletConfig) {
          result.skipped += competitorBets.length;
          continue;
        }

        const redemptionClient = createRedemptionClient(walletConfig.polyPrivateKey);
        const bettingClient = bettingClientFactory.getClient(competitorId, walletConfig);

        const betsByCondition = new Map<string, typeof competitorBets>();
        for (const bet of competitorBets) {
          const market = marketById.get(bet.marketId);
          if (!market) {
            result.errors.push(`Market ${bet.marketId} not found for bet ${bet.id}`);
            continue;
          }
          const existing = betsByCondition.get(market.conditionId) ?? [];
          existing.push(bet);
          betsByCondition.set(market.conditionId, existing);
        }

        for (const [conditionId, conditionBets] of betsByCondition) {
          try {
            const firstBet = conditionBets[0];
            if (!firstBet) continue;
            let negRisk = negRiskCache.get(firstBet.tokenId);
            if (negRisk === undefined) {
              negRisk = await bettingClient.getNegRisk(firstBet.tokenId);
              negRiskCache.set(firstBet.tokenId, negRisk);
            }

            const totalShares = conditionBets.reduce((sum, b) => sum + b.shares, 0);
            const amount = BigInt(Math.floor(totalShares * 1e6));

            const redemptionResult = await redemptionClient.redeemPositions({
              conditionId,
              winningSide: firstBet.side as "YES" | "NO",
              negRisk,
              amount,
            });

            const now = new Date();
            for (const bet of conditionBets) {
              await betsRepo.markRedeemed(bet.id, redemptionResult.txHash, now);
              await auditLog.safeRecord({
                betId: bet.id,
                event: "bet_redeemed",
                statusBefore: "settled_won",
                statusAfter: "settled_won",
                metadata: {
                  txHash: redemptionResult.txHash,
                  conditionId,
                  negRisk,
                },
              });
            }

            result.redeemed += conditionBets.length;
            logger.info("Redemption: redeemed condition", {
              conditionId,
              competitorId,
              bets: conditionBets.length,
              txHash: redemptionResult.txHash,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push(
              `Redemption failed for condition ${conditionId} (${competitorId}): ${msg}`,
            );
            logger.error("Redemption: failed", { conditionId, competitorId, error: msg });
          }
        }
      }

      return result;
    },
  };
}

export type RedemptionPipeline = ReturnType<typeof createRedemptionPipeline>;
