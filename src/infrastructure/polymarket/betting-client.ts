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

      return { orderId: response?.orderID ?? response?.id ?? String(response) };
    },

    async cancelOrder(orderId: string): Promise<void> {
      await clob.cancelOrder({ orderID: orderId });
    },

    async cancelAll(): Promise<void> {
      await clob.cancelAll();
    },

    async getOpenOrders() {
      return clob.getOpenOrders();
    },

    async getTickSize(tokenId: string): Promise<TickSize> {
      return clob.getTickSize(tokenId);
    },

    async getNegRisk(tokenId: string): Promise<boolean> {
      return clob.getNegRisk(tokenId);
    },
  };
}

export type BettingClient = ReturnType<typeof createBettingClient>;
