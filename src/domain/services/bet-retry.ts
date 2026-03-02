import type { betsRepo as betsRepoFactory } from "../../infrastructure/database/repositories/bets";
import type { BettingClientFactory } from "../../infrastructure/polymarket/betting-client-factory";
import { logger } from "../../shared/logger";
import type { WalletConfig } from "../types/competitor";
import { classifyBetError } from "./bet-errors";

export type BetRetryResult = {
  retried: number;
  succeeded: number;
  failedAgain: number;
  errors: string[];
};

export function createBetRetryService(deps: {
  betsRepo: ReturnType<typeof betsRepoFactory>;
  bettingClientFactory: BettingClientFactory;
  walletConfigs: Map<string, WalletConfig>;
  maxRetryAttempts: number;
  retryDelayMs?: number;
}) {
  const { betsRepo, bettingClientFactory, walletConfigs, maxRetryAttempts, retryDelayMs } = deps;

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

        result.retried++;

        // Write-ahead: set to submitting before retry API call
        await betsRepo.updateStatus(bet.id, "submitting");

        const client = bettingClientFactory.getClient(bet.competitorId, walletConfig);

        try {
          const { orderId } = await client.placeOrder({
            tokenId: bet.tokenId,
            price: bet.price,
            amount: bet.amount,
            side: "BUY",
          });

          await betsRepo.updateBetAfterSubmission(bet.id, {
            status: "pending",
            orderId,
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
