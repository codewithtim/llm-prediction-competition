import { logger } from "../../shared/logger.ts";

// USDC.e (bridged) on Polygon — used by Polymarket as collateral
const USDC_CONTRACT = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const POLYGON_RPCS = ["https://polygon-bor-rpc.publicnode.com", "https://1rpc.io/matic"];

// balanceOf(address) selector = keccak256("balanceOf(address)")[0:4]
const BALANCE_OF_SELECTOR = "0x70a08231";

function encodeBalanceOfCall(walletAddress: string): string {
  const addr = walletAddress.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  return `${BALANCE_OF_SELECTOR}${addr}`;
}

export async function getUsdcBalance(walletAddress: string): Promise<number | null> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [
      {
        to: USDC_CONTRACT,
        data: encodeBalanceOfCall(walletAddress),
      },
      "latest",
    ],
  });

  for (const rpc of POLYGON_RPCS) {
    try {
      const response = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      const json = (await response.json()) as { result?: string; error?: { message: string } };

      if (json.error || !json.result) {
        logger.warn("USDC balance RPC error", { rpc, walletAddress, error: json.error?.message });
        continue;
      }

      const rawBalance = BigInt(json.result);
      return Number(rawBalance) / 1e6; // USDC has 6 decimals
    } catch (err) {
      logger.warn("USDC balance RPC failed, trying next", {
        rpc,
        walletAddress,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return null;
}
