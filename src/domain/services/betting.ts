import type { betsRepo as betsRepoFactory } from "../../infrastructure/database/repositories/bets";
import type { BettingClientFactory } from "../../infrastructure/polymarket/betting-client-factory";
import type { PredictionOutput } from "../contracts/prediction";
import type { Market } from "../models/market";
import type { WalletConfig } from "../types/competitor";

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
  status: "placed" | "dry_run" | "skipped";
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
};

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

      const existingBets = await betsRepo.findByCompetitor(competitorId);
      const duplicate = existingBets.find(
        (b) => b.marketId === market.id && (b.status === "pending" || b.status === "filled"),
      );
      if (duplicate) {
        return { status: "skipped", reason: "Bet already exists for this market and competitor" };
      }

      const amount = clampStake(resolvedStake, config.maxStakePerBet);

      const pendingExposure = existingBets
        .filter((b) => b.status === "pending" || b.status === "filled")
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

      const bettingClient = bettingClientFactory.getClient(competitorId, walletConfig);

      const { orderId } = await bettingClient.placeOrder({
        tokenId,
        price,
        amount,
        side: "BUY",
      });

      const shares = amount / price;
      const betId = crypto.randomUUID();

      const bet = {
        id: betId,
        orderId,
        marketId: market.id,
        fixtureId,
        competitorId,
        tokenId,
        side: prediction.side,
        amount,
        price,
        shares,
      };

      await betsRepo.create({
        ...bet,
        status: "pending" as const,
      });

      return { status: "placed", bet };
    },
  };
}

export type BettingService = ReturnType<typeof createBettingService>;
