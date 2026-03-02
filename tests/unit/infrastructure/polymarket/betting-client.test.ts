import { describe, expect, it, mock } from "bun:test";
import type { BettingClientConfig } from "../../../../src/infrastructure/polymarket/betting-client";

const mockClobInstance = {
  createAndPostOrder: mock(() => Promise.resolve({ orderID: "order-123" })),
  cancelOrder: mock(() => Promise.resolve()),
  cancelAll: mock(() => Promise.resolve()),
  getOpenOrders: mock(() => Promise.resolve({ data: [] })),
  getTickSize: mock(() => Promise.resolve("0.01")),
  getNegRisk: mock(() => Promise.resolve(false)),
};

function MockClobClient() {
  return mockClobInstance;
}

mock.module("@polymarket/clob-client", () => ({
  ClobClient: MockClobClient,
  OrderType: { GTC: "GTC", GTD: "GTD", FOK: "FOK", FAK: "FAK" },
  Side: { BUY: "BUY", SELL: "SELL" },
}));

mock.module("@ethersproject/wallet", () => ({
  Wallet: class MockWallet {
    constructor(public privateKey: string) {}
  },
}));

const { createBettingClient } = await import(
  "../../../../src/infrastructure/polymarket/betting-client"
);

const testConfig: BettingClientConfig = {
  privateKey: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  apiKey: "test-api-key",
  apiSecret: "test-api-secret",
  apiPassphrase: "test-passphrase",
};

describe("createBettingClient", () => {
  it("returns object with expected methods", () => {
    const client = createBettingClient(testConfig);
    expect(typeof client.placeOrder).toBe("function");
    expect(typeof client.cancelOrder).toBe("function");
    expect(typeof client.cancelAll).toBe("function");
    expect(typeof client.getOpenOrders).toBe("function");
    expect(typeof client.getTickSize).toBe("function");
    expect(typeof client.getNegRisk).toBe("function");
  });

  it("placeOrder calculates size as amount/price", async () => {
    const client = createBettingClient(testConfig);

    await client.placeOrder({
      tokenId: "token_yes_123",
      price: 0.5,
      amount: 10,
      side: "BUY",
    });

    const call = (mockClobInstance.createAndPostOrder as ReturnType<typeof mock>).mock.calls.at(-1);
    const userOrder = call?.[0] as { size: number };
    expect(userOrder.size).toBe(20); // 10 / 0.5 = 20 shares
  });

  it("placeOrder fetches tick size and neg risk", async () => {
    const client = createBettingClient(testConfig);

    await client.placeOrder({
      tokenId: "token_yes_123",
      price: 0.65,
      amount: 5,
      side: "BUY",
    });

    expect(mockClobInstance.getTickSize).toHaveBeenCalledWith("token_yes_123");
    expect(mockClobInstance.getNegRisk).toHaveBeenCalledWith("token_yes_123");
  });

  it("placeOrder passes correct order params to CLOB", async () => {
    const client = createBettingClient(testConfig);

    await client.placeOrder({
      tokenId: "token_yes_123",
      price: 0.65,
      amount: 5,
      side: "BUY",
    });

    const call = (mockClobInstance.createAndPostOrder as ReturnType<typeof mock>).mock.calls.at(-1);
    const userOrder = call?.[0] as { tokenID: string; price: number; side: string };
    expect(userOrder.tokenID).toBe("token_yes_123");
    expect(userOrder.price).toBe(0.65);
    expect(userOrder.side).toBe("BUY");
  });

  it("placeOrder returns orderId from response", async () => {
    const client = createBettingClient(testConfig);

    const result = await client.placeOrder({
      tokenId: "token_yes_123",
      price: 0.65,
      amount: 5,
      side: "BUY",
    });

    expect(result.orderId).toBe("order-123");
  });

  it("placeOrder throws on CLOB error response (e.g. insufficient balance)", async () => {
    // CLOB client returns { error: string, status: number } on HTTP errors
    (mockClobInstance.createAndPostOrder as ReturnType<typeof mock>).mockImplementationOnce(() =>
      Promise.resolve({ error: "not enough balance / allowance", status: 400 }),
    );

    const client = createBettingClient(testConfig);

    await expect(
      client.placeOrder({ tokenId: "token_yes_123", price: 0.65, amount: 5, side: "BUY" }),
    ).rejects.toThrow("not enough balance / allowance");
  });

  it("placeOrder throws when response has no orderID", async () => {
    // Edge case: response has no error field but also no orderID
    (mockClobInstance.createAndPostOrder as ReturnType<typeof mock>).mockImplementationOnce(() =>
      Promise.resolve({ status: 200 }),
    );

    const client = createBettingClient(testConfig);

    await expect(
      client.placeOrder({ tokenId: "token_yes_123", price: 0.65, amount: 5, side: "BUY" }),
    ).rejects.toThrow("no orderID in response");
  });

  it("placeOrder throws when response is undefined", async () => {
    (mockClobInstance.createAndPostOrder as ReturnType<typeof mock>).mockImplementationOnce(() =>
      Promise.resolve(undefined),
    );

    const client = createBettingClient(testConfig);

    await expect(
      client.placeOrder({ tokenId: "token_yes_123", price: 0.65, amount: 5, side: "BUY" }),
    ).rejects.toThrow("no orderID in response");
  });

  it("cancelOrder delegates to CLOB", async () => {
    const client = createBettingClient(testConfig);

    await client.cancelOrder("order-to-cancel");

    expect(mockClobInstance.cancelOrder).toHaveBeenCalledWith({
      orderID: "order-to-cancel",
    });
  });

  it("getTickSize delegates to CLOB", async () => {
    const client = createBettingClient(testConfig);

    const tickSize = await client.getTickSize("token_123");

    expect(tickSize).toBe("0.01");
    expect(mockClobInstance.getTickSize).toHaveBeenCalledWith("token_123");
  });
});
