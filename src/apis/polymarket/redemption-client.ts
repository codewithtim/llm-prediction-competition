import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";

const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";
const POLYGON_CHAIN_ID = 137;

const CONTRACTS = {
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
  negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  collateral: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
};

const CTF_ABI = [
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function balanceOf(address owner, uint256 id) view returns (uint256)",
];

const NEG_RISK_ADAPTER_ABI = ["function redeemPositions(bytes32 conditionId, uint256[] amounts)"];

export type RedemptionResult = {
  txHash: string;
  conditionId: string;
};

async function getGasOverrides(provider: JsonRpcProvider) {
  const feeData = await provider.getFeeData();
  const minTip = BigNumber.from("30000000000"); // 30 gwei floor for Polygon
  const tip = feeData.maxPriorityFeePerGas?.gt(minTip) ? feeData.maxPriorityFeePerGas : minTip;
  const baseFee = feeData.lastBaseFeePerGas ?? BigNumber.from("30000000000");
  return {
    maxPriorityFeePerGas: tip,
    maxFeePerGas: baseFee.mul(2).add(tip),
  };
}

export function createRedemptionClient(privateKey: string) {
  const provider = new JsonRpcProvider(POLYGON_RPC, {
    chainId: POLYGON_CHAIN_ID,
    name: "matic",
  });
  const signer = new Wallet(privateKey, provider);

  return {
    async getTokenBalance(tokenId: string): Promise<bigint> {
      const ctf = new Contract(CONTRACTS.conditionalTokens, CTF_ABI, provider);
      const walletAddress = await signer.getAddress();
      const balance: BigNumber = await ctf.balanceOf(walletAddress, tokenId);
      return balance.toBigInt();
    },

    async ensureNegRiskApproval(): Promise<void> {
      const ctf = new Contract(CONTRACTS.conditionalTokens, CTF_ABI, signer);
      const walletAddress = await signer.getAddress();
      const approved = await ctf.isApprovedForAll(walletAddress, CONTRACTS.negRiskAdapter);
      if (!approved) {
        const gas = await getGasOverrides(provider);
        const tx = await ctf.setApprovalForAll(CONTRACTS.negRiskAdapter, true, gas);
        await tx.wait();
      }
    },

    async redeemPositions(params: {
      conditionId: string;
      winningSide: "YES" | "NO";
      negRisk: boolean;
      amount: bigint;
    }): Promise<RedemptionResult> {
      const gas = await getGasOverrides(provider);
      let tx: { hash: string; wait: () => Promise<unknown> };

      if (params.negRisk) {
        const amounts = params.winningSide === "YES" ? [params.amount, 0n] : [0n, params.amount];
        const adapter = new Contract(CONTRACTS.negRiskAdapter, NEG_RISK_ADAPTER_ABI, signer);
        tx = await adapter.redeemPositions(params.conditionId, amounts, gas);
      } else {
        const indexSet = params.winningSide === "YES" ? 1 : 2;
        const ctf = new Contract(CONTRACTS.conditionalTokens, CTF_ABI, signer);
        const parentCollectionId = `0x${"0".repeat(64)}`;
        tx = await ctf.redeemPositions(
          CONTRACTS.collateral,
          parentCollectionId,
          params.conditionId,
          [indexSet],
          gas,
        );
      }

      await tx.wait();
      return { txHash: tx.hash, conditionId: params.conditionId };
    },
  };
}

export type RedemptionClient = ReturnType<typeof createRedemptionClient>;
