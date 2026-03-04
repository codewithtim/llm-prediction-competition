import { logger } from "../../shared/logger.ts";

// USDC.e (bridged) on Polygon — used by Polymarket
const USDC_CONTRACT = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const POLYGON_RPC = "https://polygon-rpc.com";

// balanceOf(address) selector = keccak256("balanceOf(address)")[0:4]
const BALANCE_OF_SELECTOR = "0x70a08231";

function encodeBalanceOfCall(walletAddress: string): string {
  const addr = walletAddress.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  return `${BALANCE_OF_SELECTOR}${addr}`;
}

export async function getUsdcBalance(walletAddress: string): Promise<number | null> {
  try {
    const response = await fetch(POLYGON_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
    });

    const json = (await response.json()) as { result?: string; error?: { message: string } };

    if (json.error || !json.result) {
      logger.warn("USDC balance RPC error", { walletAddress, error: json.error?.message });
      return null;
    }

    const rawBalance = BigInt(json.result);
    return Number(rawBalance) / 1e6; // USDC has 6 decimals
  } catch (err) {
    logger.warn("Failed to fetch USDC balance", {
      walletAddress,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
