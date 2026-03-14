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
];

const NEG_RISK_ADAPTER_ABI = ["function redeemPositions(bytes32 conditionId, uint256[] amounts)"];

export type RedemptionResult = {
  txHash: string;
  conditionId: string;
};

export function createRedemptionClient(privateKey: string) {
  const provider = new JsonRpcProvider(POLYGON_RPC, {
    chainId: POLYGON_CHAIN_ID,
    name: "matic",
  });
  const signer = new Wallet(privateKey, provider);

  return {
    async ensureNegRiskApproval(): Promise<void> {
      const ctf = new Contract(CONTRACTS.conditionalTokens, CTF_ABI, signer);
      const walletAddress = await signer.getAddress();
      const approved = await ctf.isApprovedForAll(walletAddress, CONTRACTS.negRiskAdapter);
      if (!approved) {
        const tx = await ctf.setApprovalForAll(CONTRACTS.negRiskAdapter, true);
        await tx.wait();
      }
    },

    async redeemPositions(params: {
      conditionId: string;
      winningSide: "YES" | "NO";
      negRisk: boolean;
      amount: bigint;
    }): Promise<RedemptionResult> {
      let tx: { hash: string; wait: () => Promise<unknown> };

      if (params.negRisk) {
        const amounts = params.winningSide === "YES" ? [params.amount, 0n] : [0n, params.amount];
        const adapter = new Contract(CONTRACTS.negRiskAdapter, NEG_RISK_ADAPTER_ABI, signer);
        tx = await adapter.redeemPositions(params.conditionId, amounts);
      } else {
        const indexSet = params.winningSide === "YES" ? 1 : 2;
        const ctf = new Contract(CONTRACTS.conditionalTokens, CTF_ABI, signer);
        const parentCollectionId = `0x${"0".repeat(64)}`;
        tx = await ctf.redeemPositions(
          CONTRACTS.collateral,
          parentCollectionId,
          params.conditionId,
          [indexSet],
        );
      }

      await tx.wait();
      return { txHash: tx.hash, conditionId: params.conditionId };
    },
  };
}

export type RedemptionClient = ReturnType<typeof createRedemptionClient>;
