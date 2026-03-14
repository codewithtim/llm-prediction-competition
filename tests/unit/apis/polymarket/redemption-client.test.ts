import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockWait = mock(() => Promise.resolve({}));
const mockContractRedeemPositions = mock(() =>
  Promise.resolve({ hash: "0xtxhash123", wait: mockWait }),
);
const mockIsApprovedForAll = mock(() => Promise.resolve(false));
const mockSetApprovalForAll = mock(() => Promise.resolve({ wait: mockWait }));

mock.module("@ethersproject/contracts", () => ({
  Contract: class MockContract {
    redeemPositions = mockContractRedeemPositions;
    isApprovedForAll = mockIsApprovedForAll;
    setApprovalForAll = mockSetApprovalForAll;
  },
}));
mock.module("@ethersproject/providers", () => ({
  JsonRpcProvider: class MockProvider {},
}));
mock.module("@ethersproject/wallet", () => ({
  Wallet: class MockWallet {
    getAddress = mock(() => Promise.resolve("0xwalletaddr"));
  },
}));

const { createRedemptionClient } = await import(
  "../../../../src/apis/polymarket/redemption-client.ts"
);

describe("redemption client", () => {
  beforeEach(() => {
    mockContractRedeemPositions.mockReset();
    mockWait.mockReset();
    mockIsApprovedForAll.mockReset();
    mockSetApprovalForAll.mockReset();
    mockWait.mockImplementation(() => Promise.resolve({}));
    mockIsApprovedForAll.mockImplementation(() => Promise.resolve(false));
    mockSetApprovalForAll.mockImplementation(() => Promise.resolve({ wait: mockWait }));
  });

  test("calls CTF contract for non-neg-risk and returns txHash", async () => {
    mockContractRedeemPositions.mockImplementation(() =>
      Promise.resolve({ hash: "0xctf_tx", wait: mockWait }),
    );

    const client = createRedemptionClient("0xprivatekey");
    const result = await client.redeemPositions({
      conditionId: "0xcond1",
      winningSide: "YES",
      negRisk: false,
      amount: BigInt(15380000),
    });

    expect(result.txHash).toBe("0xctf_tx");
    expect(result.conditionId).toBe("0xcond1");
  });

  test("calls NegRiskAdapter with amounts array for neg-risk", async () => {
    mockContractRedeemPositions.mockImplementation(() =>
      Promise.resolve({ hash: "0xnr_tx", wait: mockWait }),
    );

    const client = createRedemptionClient("0xprivatekey");
    const result = await client.redeemPositions({
      conditionId: "0xcond2",
      winningSide: "NO",
      negRisk: true,
      amount: BigInt(10000000),
    });

    expect(result.txHash).toBe("0xnr_tx");
    expect(result.conditionId).toBe("0xcond2");
  });

  test("propagates contract call errors", async () => {
    mockContractRedeemPositions.mockImplementation(() =>
      Promise.reject(new Error("insufficient gas")),
    );

    const client = createRedemptionClient("0xprivatekey");
    await expect(
      client.redeemPositions({
        conditionId: "0xcond3",
        winningSide: "YES",
        negRisk: false,
        amount: BigInt(5000000),
      }),
    ).rejects.toThrow("insufficient gas");
  });

  test("ensureNegRiskApproval sets approval when not already approved", async () => {
    mockIsApprovedForAll.mockImplementation(() => Promise.resolve(false));

    const client = createRedemptionClient("0xprivatekey");
    await client.ensureNegRiskApproval();

    expect(mockIsApprovedForAll).toHaveBeenCalledTimes(1);
    expect(mockSetApprovalForAll).toHaveBeenCalledTimes(1);
  });

  test("ensureNegRiskApproval skips when already approved", async () => {
    mockIsApprovedForAll.mockImplementation(() => Promise.resolve(true));

    const client = createRedemptionClient("0xprivatekey");
    await client.ensureNegRiskApproval();

    expect(mockIsApprovedForAll).toHaveBeenCalledTimes(1);
    expect(mockSetApprovalForAll).toHaveBeenCalledTimes(0);
  });
});
