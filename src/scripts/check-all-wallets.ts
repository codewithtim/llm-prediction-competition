/**
 * Check balances for all wallets: POL, native USDC, bridged USDC.e
 *
 * Usage: bun run src/scripts/check-all-wallets.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import { Contract } from "@ethersproject/contracts";
import { JsonRpcProvider } from "@ethersproject/providers";
import { formatUnits } from "@ethersproject/units";

const POLYGON_RPC = "https://1rpc.io/matic";
const provider = new JsonRpcProvider(POLYGON_RPC, { chainId: 137, name: "matic" });

const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // bridged (Polymarket uses this)
const USDC_NATIVE = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";

const usdcE = new Contract(USDC_E, ERC20_ABI, provider);
const usdcNative = new Contract(USDC_NATIVE, ERC20_ABI, provider);

const walletDir = "data/wallets";
const files = readdirSync(walletDir).filter((f) => f.endsWith(".json"));

console.log(
  "Wallet".padEnd(25),
  "POL".padStart(10),
  "USDC.e".padStart(10),
  "USDC(native)".padStart(14),
  "Allowance".padStart(12),
);
console.log("-".repeat(75));

for (const file of files) {
  const w = JSON.parse(readFileSync(`${walletDir}/${file}`, "utf-8"));
  const addr = w.walletAddress;
  const name = file.replace(".json", "");

  const [pol, bridged, native, allowance] = await Promise.all([
    provider.getBalance(addr),
    usdcE.balanceOf(addr),
    usdcNative.balanceOf(addr),
    usdcE.allowance(addr, EXCHANGE),
  ]);

  console.log(
    name.padEnd(25),
    formatUnits(pol, 18).substring(0, 8).padStart(10),
    formatUnits(bridged, 6).padStart(10),
    formatUnits(native, 6).padStart(14),
    allowance.isZero() ? "NONE".padStart(12) : "SET".padStart(12),
  );
}
