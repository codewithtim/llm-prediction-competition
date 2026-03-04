import { ClobClient } from "@polymarket/clob-client";

const CLOB_BASE_URL = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;

export function createPricingClient() {
  const clob = new ClobClient(CLOB_BASE_URL, POLYGON_CHAIN_ID);

  return {
    async getOrderBook(tokenId: string) {
      try {
        return await clob.getOrderBook(tokenId);
      } catch (err) {
        throw new Error(
          `Polymarket getOrderBook failed (tokenId: ${tokenId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async getMidpoint(tokenId: string) {
      try {
        return await clob.getMidpoint(tokenId);
      } catch (err) {
        throw new Error(
          `Polymarket getMidpoint failed (tokenId: ${tokenId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async getPrice(tokenId: string, side: "BUY" | "SELL") {
      try {
        return await clob.getPrice(tokenId, side);
      } catch (err) {
        throw new Error(
          `Polymarket getPrice failed (tokenId: ${tokenId}, side: ${side}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async getSpread(tokenId: string) {
      try {
        return await clob.getSpread(tokenId);
      } catch (err) {
        throw new Error(
          `Polymarket getSpread failed (tokenId: ${tokenId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async getPricesHistory(params: {
      market?: string;
      startTs?: number;
      endTs?: number;
      fidelity?: number;
    }) {
      try {
        return await clob.getPricesHistory(params);
      } catch (err) {
        throw new Error(
          `Polymarket getPricesHistory failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

export type PricingClient = ReturnType<typeof createPricingClient>;
