import type { betsRepo as betsRepoFactory } from "../../infrastructure/database/repositories/bets";
import type { BettingClientFactory } from "../../infrastructure/polymarket/betting-client-factory";
import type { PredictionOutput } from "../contracts/prediction";
import type { Market } from "../models/market";
import type { BetErrorCategory } from "../models/prediction";
import type { WalletConfig } from "../types/competitor";
import { classifyBetError } from "./bet-errors";

export type BettingConfig = {
  maxStakePerBet: number;
  maxBetPctOfBankroll: number;
  maxTotalExposure: number;
  initialBankroll: number;
  minBetAmount: number;
  dryRun: boolean;
};

export type PlaceBetInput = {
  prediction: PredictionOutput;
  resolvedStake: number;
  market: Market;
  fixtureId: number;
  competitorId: string;
  walletConfig?: WalletConfig;
};

export type PlaceBetResult = {
  status: "placed" | "dry_run" | "skipped" | "failed";
  bet?: {
    id: string;
    orderId: string;
    marketId: string;
    fixtureId: number;
    competitorId: string;
    tokenId: string;
    side: "YES" | "NO";
    amount: number;
    price: number;
    shares: number;
  };
  reason?: string;
  error?: string;
  errorCategory?: BetErrorCategory;
};

const BLOCKING_STATUSES = new Set(["submitting", "pending", "filled"]);

export function resolveTokenId(market: Market, side: "YES" | "NO"): string {
  return side === "YES" ? market.tokenIds[0] : market.tokenIds[1];
}

export function clampStake(stake: number, maxStake: number): number {
  return Math.max(0.01, Math.min(stake, maxStake));
}

export function createBettingService(deps: {
  bettingClientFactory: BettingClientFactory;
  betsRepo: ReturnType<typeof betsRepoFactory>;
  config: BettingConfig;
}) {
  const { bettingClientFactory, betsRepo, config } = deps;

  return {
    async placeBet(input: PlaceBetInput): Promise<PlaceBetResult> {
      const { prediction, resolvedStake, market, fixtureId, competitorId, walletConfig } = input;

      if (!market.acceptingOrders) {
        return { status: "skipped", reason: "Market is not accepting orders" };
      }

      // Anti-double-bet: check for existing active bets on this market+competitor
      const existingBets = await betsRepo.findByCompetitor(competitorId);
      const duplicate = existingBets.find(
        (b) => b.marketId === market.id && BLOCKING_STATUSES.has(b.status),
      );
      if (duplicate) {
        return { status: "skipped", reason: "Bet already exists for this market and competitor" };
      }

      const amount = clampStake(resolvedStake, config.maxStakePerBet);

      // Exposure includes submitting bets (locked capital)
      const pendingExposure = existingBets
        .filter((b) => b.status === "submitting" || b.status === "pending" || b.status === "filled")
        .reduce((sum, b) => sum + b.amount, 0);

      if (pendingExposure + amount > config.maxTotalExposure) {
        return { status: "skipped", reason: "Would exceed maximum total exposure" };
      }

      const tokenId = resolveTokenId(market, prediction.side);
      const price = Number.parseFloat(
        prediction.side === "YES" ? market.outcomePrices[0] : market.outcomePrices[1],
      );

      if (config.dryRun) {
        return { status: "dry_run" };
      }

      if (!walletConfig) {
        return { status: "skipped", reason: "No wallet configured for competitor" };
      }

      const shares = amount / price;
      const betId = crypto.randomUUID();

      const bet = {
        id: betId,
        marketId: market.id,
        fixtureId,
        competitorId,
        tokenId,
        side: prediction.side,
        amount,
        price,
        shares,
      };

      // Write-ahead: create row with submitting status BEFORE API call
      await betsRepo.create({
        ...bet,
        orderId: null,
        status: "submitting" as const,
      });

      const bettingClient = bettingClientFactory.getClient(competitorId, walletConfig);

      try {
        const { orderId } = await bettingClient.placeOrder({
          tokenId,
          price,
          amount,
          side: "BUY",
        });

        // Success: update to pending with real orderId
        await betsRepo.updateBetAfterSubmission(betId, {
          status: "pending",
          orderId,
        });

        return { status: "placed", bet: { ...bet, orderId } };
      } catch (err) {
        // Failure: update to failed with error details
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorCategory = classifyBetError(err);

        await betsRepo.updateBetAfterSubmission(betId, {
          status: "failed",
          errorMessage,
          errorCategory,
          attempts: 1,
          lastAttemptAt: new Date(),
        });

        return { status: "failed", error: errorMessage, errorCategory };
      }
    },
  };
}

export type BettingService = ReturnType<typeof createBettingService>;
