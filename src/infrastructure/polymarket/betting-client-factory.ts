import type { WalletConfig } from "../../domain/types/competitor";
import { type BettingClient, createBettingClient } from "./betting-client";

export function createBettingClientFactory() {
  const cache = new Map<string, BettingClient>();

  return {
    getClient(competitorId: string, walletConfig: WalletConfig): BettingClient {
      const cached = cache.get(competitorId);
      if (cached) return cached;

      const client = createBettingClient({
        privateKey: walletConfig.polyPrivateKey,
        apiKey: walletConfig.polyApiKey,
        apiSecret: walletConfig.polyApiSecret,
        apiPassphrase: walletConfig.polyApiPassphrase,
      });

      cache.set(competitorId, client);
      return client;
    },
  };
}

export type BettingClientFactory = ReturnType<typeof createBettingClientFactory>;
