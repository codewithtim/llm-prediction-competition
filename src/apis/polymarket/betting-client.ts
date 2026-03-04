import { Wallet } from "@ethersproject/wallet";
import type { TickSize } from "@polymarket/clob-client";
import { ClobClient, OrderType, Side } from "@polymarket/clob-client";

const CLOB_BASE_URL = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;
const SIGNATURE_TYPE_EOA = 0;

export type BettingClientConfig = {
  privateKey: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
};

export type OrderResult = {
  orderId: string;
};

export function createBettingClient(config: BettingClientConfig) {
  const signer = new Wallet(config.privateKey);
  const creds = {
    key: config.apiKey,
    secret: config.apiSecret,
    passphrase: config.apiPassphrase,
  };
  const clob = new ClobClient(CLOB_BASE_URL, POLYGON_CHAIN_ID, signer, creds, SIGNATURE_TYPE_EOA);

  return {
    async placeOrder(params: {
      tokenId: string;
      price: number;
      amount: number;
      side: "BUY" | "SELL";
    }): Promise<OrderResult> {
      const tickSize: TickSize = await clob.getTickSize(params.tokenId);
      const negRisk: boolean = await clob.getNegRisk(params.tokenId);
      const size = params.amount / params.price;

      const response = await clob.createAndPostOrder(
        {
          tokenID: params.tokenId,
          price: params.price,
          size,
          side: params.side === "BUY" ? Side.BUY : Side.SELL,
        },
        { tickSize, negRisk },
        OrderType.GTC,
      );

      // CLOB client defaults throwOnError: false — on HTTP errors it returns
      // { error: "not enough balance / allowance", status: 400 } instead of throwing
      if (response && typeof response === "object" && "error" in response) {
        const errObj = response as { error?: string; status?: number };
        throw new Error(errObj.error ?? `Order rejected (HTTP ${errObj.status ?? "unknown"})`);
      }

      // Validate we got a real order ID back
      const orderId = response?.orderID ?? response?.id;
      if (!orderId || typeof orderId !== "string") {
        throw new Error(`Order rejected (no orderID in response: ${String(response)})`);
      }

      return { orderId };
    },

    async cancelOrder(orderId: string): Promise<void> {
      try {
        await clob.cancelOrder({ orderID: orderId });
      } catch (err) {
        throw new Error(
          `Polymarket cancelOrder failed (orderId: ${orderId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async cancelAll(): Promise<void> {
      try {
        await clob.cancelAll();
      } catch (err) {
        throw new Error(
          `Polymarket cancelAll failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async getOpenOrders() {
      try {
        return await clob.getOpenOrders();
      } catch (err) {
        throw new Error(
          `Polymarket getOpenOrders failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async getTickSize(tokenId: string): Promise<TickSize> {
      try {
        return await clob.getTickSize(tokenId);
      } catch (err) {
        throw new Error(
          `Polymarket getTickSize failed (tokenId: ${tokenId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async getNegRisk(tokenId: string): Promise<boolean> {
      try {
        return await clob.getNegRisk(tokenId);
      } catch (err) {
        throw new Error(
          `Polymarket getNegRisk failed (tokenId: ${tokenId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

export type BettingClient = ReturnType<typeof createBettingClient>;

export function createStubBettingClient(): BettingClient {
  const notConfigured = () => {
    throw new Error(
      "Polymarket credentials not configured — set POLY_* env vars to place real bets",
    );
  };

  return {
    placeOrder: notConfigured,
    cancelOrder: notConfigured,
    cancelAll: notConfigured,
    getOpenOrders: notConfigured,
    getTickSize: notConfigured,
    getNegRisk: notConfigured,
  };
}
