import { ClobClient } from "@polymarket/clob-client";

const CLOB_BASE_URL = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;

export function createPricingClient() {
  const clob = new ClobClient(CLOB_BASE_URL, POLYGON_CHAIN_ID);

  return {
    async getOrderBook(tokenId: string) {
      return clob.getOrderBook(tokenId);
    },

    async getMidpoint(tokenId: string) {
      return clob.getMidpoint(tokenId);
    },

    async getPrice(tokenId: string, side: "BUY" | "SELL") {
      return clob.getPrice(tokenId, side);
    },

    async getSpread(tokenId: string) {
      return clob.getSpread(tokenId);
    },

    async getPricesHistory(params: {
      market?: string;
      startTs?: number;
      endTs?: number;
      fidelity?: number;
    }) {
      return clob.getPricesHistory(params);
    },
  };
}

export type PricingClient = ReturnType<typeof createPricingClient>;
