import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockWait = mock(() => Promise.resolve({}));
const mockContractRedeemPositions = mock(() =>
  Promise.resolve({ hash: "0xtxhash123", wait: mockWait }),
);
const mockIsApprovedForAll = mock(() => Promise.resolve(false));
const mockSetApprovalForAll = mock(() => Promise.resolve({ wait: mockWait }));
const mockBalanceOf = mock(() => Promise.resolve(makeBigNumber(5000000)));

mock.module("@ethersproject/contracts", () => ({
  Contract: class MockContract {
    redeemPositions = mockContractRedeemPositions;
    isApprovedForAll = mockIsApprovedForAll;
    setApprovalForAll = mockSetApprovalForAll;
    balanceOf = mockBalanceOf;
  },
}));

function makeBigNumber(value: number) {
  return {
    _isBigNumber: true,
    _value: value,
    gt: (other: { _value: number }) => value > other._value,
    mul: (n: number) => makeBigNumber(value * n),
    add: (other: { _value: number }) => makeBigNumber(value + other._value),
    toHexString: () => `0x${value.toString(16)}`,
    toBigInt: () => BigInt(value),
  };
}

const mockGetFeeData = mock(() =>
  Promise.resolve({
    maxPriorityFeePerGas: null,
    lastBaseFeePerGas: null,
  }),
);

mock.module("@ethersproject/bignumber", () => ({
  BigNumber: { from: (v: string | number) => makeBigNumber(Number(v)) },
}));
mock.module("@ethersproject/providers", () => ({
  JsonRpcProvider: class MockProvider {
    getFeeData = mockGetFeeData;
  },
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
    mockGetFeeData.mockReset();
    mockBalanceOf.mockReset();
    mockWait.mockImplementation(() => Promise.resolve({}));
    mockIsApprovedForAll.mockImplementation(() => Promise.resolve(false));
    mockSetApprovalForAll.mockImplementation(() => Promise.resolve({ wait: mockWait }));
    mockGetFeeData.mockImplementation(() =>
      Promise.resolve({ maxPriorityFeePerGas: null, lastBaseFeePerGas: null }),
    );
    mockBalanceOf.mockImplementation(() => Promise.resolve(makeBigNumber(5000000)));
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
    // NegRiskAdapter takes (conditionId, amounts[]) — amounts[0]=YES, amounts[1]=NO
    const callArgs = mockContractRedeemPositions.mock.calls[0] as unknown[];
    expect(callArgs[0]).toBe("0xcond2");
    expect(callArgs[1]).toEqual([0n, BigInt(10000000)]);
  });

  test("passes YES amount at index 0 for YES side on neg-risk", async () => {
    mockContractRedeemPositions.mockImplementation(() =>
      Promise.resolve({ hash: "0xyes_tx", wait: mockWait }),
    );

    const client = createRedemptionClient("0xprivatekey");
    await client.redeemPositions({
      conditionId: "0xcond4",
      winningSide: "YES",
      negRisk: true,
      amount: BigInt(5000000),
    });

    const callArgs = mockContractRedeemPositions.mock.calls[0] as unknown[];
    expect(callArgs[1]).toEqual([BigInt(5000000), 0n]);
  });

  test("passes gas overrides to contract calls", async () => {
    mockContractRedeemPositions.mockImplementation(() =>
      Promise.resolve({ hash: "0xgas_tx", wait: mockWait }),
    );

    const client = createRedemptionClient("0xprivatekey");
    await client.redeemPositions({
      conditionId: "0xcond5",
      winningSide: "YES",
      negRisk: false,
      amount: BigInt(5000000),
    });

    expect(mockGetFeeData).toHaveBeenCalledTimes(1);
    const callArgs = mockContractRedeemPositions.mock.calls[0] as unknown[];
    // Last argument should be the gas overrides object
    const lastArg = callArgs[callArgs.length - 1] as Record<string, unknown>;
    expect(lastArg).toHaveProperty("maxPriorityFeePerGas");
    expect(lastArg).toHaveProperty("maxFeePerGas");
  });

  test("passes gas overrides to setApprovalForAll", async () => {
    mockIsApprovedForAll.mockImplementation(() => Promise.resolve(false));

    const client = createRedemptionClient("0xprivatekey");
    await client.ensureNegRiskApproval();

    expect(mockGetFeeData).toHaveBeenCalledTimes(1);
    const callArgs = mockSetApprovalForAll.mock.calls[0] as unknown[];
    // setApprovalForAll(operator, true, gasOverrides)
    const lastArg = callArgs[callArgs.length - 1] as Record<string, unknown>;
    expect(lastArg).toHaveProperty("maxPriorityFeePerGas");
    expect(lastArg).toHaveProperty("maxFeePerGas");
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

  test("getTokenBalance returns on-chain CTF balance as bigint", async () => {
    mockBalanceOf.mockImplementation(() => Promise.resolve(makeBigNumber(3769997)));

    const client = createRedemptionClient("0xprivatekey");
    const balance = await client.getTokenBalance("12345");

    expect(balance).toBe(BigInt(3769997));
    expect(mockBalanceOf).toHaveBeenCalledTimes(1);
  });
});
