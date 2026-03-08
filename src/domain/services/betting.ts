import type { BettingClientFactory } from "../../apis/polymarket/betting-client-factory";
import type { AuditLogRepo } from "../../database/repositories/audit-log";
import type { betsRepo as betsRepoFactory } from "../../database/repositories/bets";
import type { BettingEventsRepo } from "../../database/repositories/betting-events";
import { safeFloat } from "../../shared/safe-float.ts";
import type { PredictionOutput } from "../contracts/prediction";
import type { Market } from "../models/market";
import type { BetErrorCategory } from "../models/prediction";
import { ACTIVE_BET_STATUSES } from "../models/prediction";
import type { WalletConfig } from "../types/competitor";
import { classifyBetError } from "./bet-errors";

export type BettingConfig = {
  maxStakePerBet: number;
  maxBetPctOfBankroll: number;
  maxTotalExposure: number;
  initialBankroll: number;
  minBetAmount: number;
  dryRun: boolean;
  proxyEnabled: boolean;
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

const BLOCKING_STATUSES = new Set<string>(ACTIVE_BET_STATUSES);

export function resolveTokenId(market: Market, side: "YES" | "NO"): string {
  return side === "YES" ? market.tokenIds[0] : market.tokenIds[1];
}

export function clampStake(stake: number, maxStake: number): number {
  return Math.max(0.01, Math.min(stake, maxStake));
}

export function createBettingService(deps: {
  bettingClientFactory: BettingClientFactory;
  betsRepo: ReturnType<typeof betsRepoFactory>;
  auditLog: AuditLogRepo;
  bettingEventsRepo: BettingEventsRepo;
  config: BettingConfig;
}) {
  const { bettingClientFactory, betsRepo, auditLog, bettingEventsRepo, config } = deps;

  return {
    async placeBet(input: PlaceBetInput): Promise<PlaceBetResult> {
      const { prediction, resolvedStake, market, fixtureId, competitorId, walletConfig } = input;

      if (!market.acceptingOrders) {
        await bettingEventsRepo.safeRecord({
          competitorId,
          marketId: market.id,
          fixtureId,
          event: "bet_skipped",
          reason: "Market is not accepting orders",
        });
        return { status: "skipped", reason: "Market is not accepting orders" };
      }

      // Fast-path duplicate check: avoids a DB write + API call for the common case.
      // The atomic createIfNoActiveBet() below is the real safety net against races.
      const existingBets = await betsRepo.findByCompetitor(competitorId);
      const duplicate = existingBets.find(
        (b) => b.marketId === market.id && BLOCKING_STATUSES.has(b.status),
      );
      if (duplicate) {
        await bettingEventsRepo.safeRecord({
          competitorId,
          marketId: market.id,
          fixtureId,
          event: "bet_skipped",
          reason: "Bet already exists for this market and competitor",
        });
        return { status: "skipped", reason: "Bet already exists for this market and competitor" };
      }

      const amount = clampStake(resolvedStake, config.maxStakePerBet);

      // Exposure includes submitting bets (locked capital)
      const pendingExposure = existingBets
        .filter((b) => BLOCKING_STATUSES.has(b.status))
        .reduce((sum, b) => sum + b.amount, 0);

      if (pendingExposure + amount > config.maxTotalExposure) {
        await bettingEventsRepo.safeRecord({
          competitorId,
          marketId: market.id,
          fixtureId,
          event: "bet_skipped",
          reason: "Would exceed maximum total exposure",
          metadata: { pendingExposure, amount, maxTotalExposure: config.maxTotalExposure },
        });
        return { status: "skipped", reason: "Would exceed maximum total exposure" };
      }

      const tokenId = resolveTokenId(market, prediction.side);
      const price = safeFloat(
        Number.parseFloat(
          prediction.side === "YES" ? market.outcomePrices[0] : market.outcomePrices[1],
        ),
      );

      if (price <= 0) {
        await bettingEventsRepo.safeRecord({
          competitorId,
          marketId: market.id,
          fixtureId,
          event: "bet_skipped",
          reason: "Invalid price (zero or non-finite)",
          metadata: { price },
        });
        return { status: "skipped", reason: "Invalid price (zero or non-finite)" };
      }

      if (config.dryRun) {
        await bettingEventsRepo.safeRecord({
          competitorId,
          marketId: market.id,
          fixtureId,
          event: "bet_dry_run",
          reason: "Dry run mode",
        });
        return { status: "dry_run" };
      }

      if (!walletConfig) {
        await bettingEventsRepo.safeRecord({
          competitorId,
          marketId: market.id,
          fixtureId,
          event: "bet_skipped",
          reason: "No wallet configured for competitor",
        });
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

      const createResult = await betsRepo.createIfNoActiveBet({
        ...bet,
        orderId: null,
        status: "submitting" as const,
      });
      if (createResult === "duplicate") {
        return { status: "skipped", reason: "Bet already exists for this market and competitor" };
      }

      await auditLog.safeRecord({
        betId,
        event: "bet_created",
        statusBefore: null,
        statusAfter: "submitting",
        metadata: {
          marketId: market.id,
          price,
          stake: amount,
          side: prediction.side,
          proxyEnabled: config.proxyEnabled,
        },
      });

      const bettingClient = bettingClientFactory.getClient(competitorId, walletConfig);

      try {
        const { orderId } = await bettingClient.placeOrder({
          tokenId,
          price,
          amount,
          side: "BUY",
        });

        await betsRepo.updateBetAfterSubmission(betId, {
          status: "pending",
          orderId,
        });

        await auditLog.safeRecord({
          betId,
          event: "order_submitted",
          statusBefore: "submitting",
          statusAfter: "pending",
          orderId,
          metadata: { proxyEnabled: config.proxyEnabled },
        });

        return { status: "placed", bet: { ...bet, orderId } };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorCategory = classifyBetError(err);

        await betsRepo.updateBetAfterSubmission(betId, {
          status: "failed",
          errorMessage,
          errorCategory,
          attempts: 1,
          lastAttemptAt: new Date(),
        });

        await auditLog.safeRecord({
          betId,
          event: "order_failed",
          statusBefore: "submitting",
          statusAfter: "failed",
          error: errorMessage,
          errorCategory,
          metadata: { proxyEnabled: config.proxyEnabled },
        });

        return { status: "failed", error: errorMessage, errorCategory };
      }
    },
  };
}

export type BettingService = ReturnType<typeof createBettingService>;
