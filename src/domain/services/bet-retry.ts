import type { BettingClientFactory } from "../../apis/polymarket/betting-client-factory";
import type { AuditLogRepo } from "../../database/repositories/audit-log";
import type { betsRepo as betsRepoFactory } from "../../database/repositories/bets";
import type { predictionsRepo as predictionsRepoFactory } from "../../database/repositories/predictions";
import { logger } from "../../shared/logger";
import type { WalletConfig } from "../types/competitor";
import { classifyBetError, extractMinBetSize } from "./bet-errors";

export type BetRetryResult = {
  retried: number;
  succeeded: number;
  failedAgain: number;
  errors: string[];
};

export function createBetRetryService(deps: {
  betsRepo: ReturnType<typeof betsRepoFactory>;
  bettingClientFactory: BettingClientFactory;
  auditLog: AuditLogRepo;
  predictionsRepo: ReturnType<typeof predictionsRepoFactory>;
  walletConfigs: Map<string, WalletConfig>;
  maxRetryAttempts: number;
  retryDelayMs?: number;
  maxStakePerBet: number;
}) {
  const {
    betsRepo,
    bettingClientFactory,
    auditLog,
    predictionsRepo,
    walletConfigs,
    maxRetryAttempts,
    retryDelayMs,
    maxStakePerBet,
  } = deps;

  return {
    async retryFailedBets(): Promise<BetRetryResult> {
      const result: BetRetryResult = {
        retried: 0,
        succeeded: 0,
        failedAgain: 0,
        errors: [],
      };

      const retryableBets = await betsRepo.findRetryableBets(maxRetryAttempts, retryDelayMs);
      if (retryableBets.length === 0) return result;

      for (const bet of retryableBets) {
        const walletConfig = walletConfigs.get(bet.competitorId);
        if (!walletConfig) {
          result.errors.push(`No wallet config for competitor ${bet.competitorId}`);
          continue;
        }

        // Guard: skip if another bet was placed since this one failed.
        // Not fully atomic (TOCTOU), but the partial unique index on bets(market_id, competitor_id)
        // WHERE status IN (...) provides the real safety net at the DB level.
        const alreadyActive = await betsRepo.hasActiveBetForMarket(bet.marketId, bet.competitorId);
        if (alreadyActive) {
          logger.info("Bet retry: skipped — active bet already exists for market", {
            betId: bet.id,
            marketId: bet.marketId,
            competitorId: bet.competitorId,
          });
          continue;
        }

        // Auto-bump logic for order_too_small
        let retryAmount = bet.amount;
        let stakeAdjustment:
          | {
              originalAmount: number;
              bumpedAmount: number;
              reason: string;
              minSizeFromError: number;
            }
          | undefined;

        if (bet.errorCategory === "order_too_small" && bet.errorMessage) {
          const minSize = extractMinBetSize(bet.errorMessage);
          if (minSize && minSize > bet.amount) {
            if (minSize > maxStakePerBet) {
              logger.warn("Bet retry: min bet size exceeds max stake, skipping", {
                betId: bet.id,
                minSize,
                maxStakePerBet,
              });
              result.errors.push(
                `Bet ${bet.id}: min size $${minSize} exceeds max stake $${maxStakePerBet}`,
              );
              continue;
            }

            retryAmount = minSize;
            await betsRepo.updateAmount(bet.id, retryAmount);

            await predictionsRepo.addStakeAdjustment(bet.marketId, bet.competitorId, {
              originalStake: bet.amount,
              adjustedStake: retryAmount,
              reason: "min_bet_bump",
              minSizeFromError: minSize,
              adjustedAt: new Date().toISOString(),
            });

            stakeAdjustment = {
              originalAmount: bet.amount,
              bumpedAmount: retryAmount,
              reason: "order_too_small",
              minSizeFromError: minSize,
            };
          }
        }

        result.retried++;

        await betsRepo.updateStatus(bet.id, "submitting");
        await auditLog.safeRecord({
          betId: bet.id,
          event: "retry_started",
          statusBefore: "failed",
          statusAfter: "submitting",
          metadata: {
            attempt: bet.attempts + 1,
            previousError: bet.errorMessage,
            ...(stakeAdjustment && { stakeAdjustment }),
          },
        });

        const client = bettingClientFactory.getClient(bet.competitorId, walletConfig);

        try {
          const { orderId } = await client.placeOrder({
            tokenId: bet.tokenId,
            price: bet.price,
            amount: retryAmount,
            side: "BUY",
          });

          await betsRepo.updateBetAfterSubmission(bet.id, {
            status: "pending",
            orderId,
          });

          await auditLog.safeRecord({
            betId: bet.id,
            event: "retry_succeeded",
            statusBefore: "submitting",
            statusAfter: "pending",
            orderId,
            metadata: { attempt: bet.attempts + 1 },
          });

          result.succeeded++;
          logger.info("Bet retry: succeeded", {
            betId: bet.id,
            orderId,
            attempt: bet.attempts + 1,
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const errorCategory = classifyBetError(err);

          await betsRepo.updateBetAfterSubmission(bet.id, {
            status: "failed",
            errorMessage,
            errorCategory,
            attempts: bet.attempts + 1,
            lastAttemptAt: new Date(),
          });

          await auditLog.safeRecord({
            betId: bet.id,
            event: "retry_failed",
            statusBefore: "submitting",
            statusAfter: "failed",
            error: errorMessage,
            errorCategory,
            metadata: { attempt: bet.attempts + 1 },
          });

          result.failedAgain++;
          logger.warn("Bet retry: failed again", {
            betId: bet.id,
            attempt: bet.attempts + 1,
            error: errorMessage,
          });
        }
      }

      return result;
    },
  };
}

export type BetRetryService = ReturnType<typeof createBetRetryService>;
