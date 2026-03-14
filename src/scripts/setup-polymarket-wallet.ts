/**
 * Set up a wallet for Polymarket trading on Polygon.
 * Checks balances and approves the Polymarket exchange contracts to spend USDC.
 *
 * Usage: bun run src/scripts/setup-polymarket-wallet.ts
 */

import { readFileSync } from "node:fs";
import { MaxUint256 } from "@ethersproject/constants";
import { Contract } from "@ethersproject/contracts";
import { JsonRpcProvider } from "@ethersproject/providers";
import { formatUnits } from "@ethersproject/units";
import { Wallet } from "@ethersproject/wallet";

// Polygon mainnet
const POLYGON_RPC = "https://1rpc.io/matic";

// Polymarket contract addresses on Polygon (from @polymarket/clob-client config)
const CONTRACTS = {
  exchange: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  negRiskExchange: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  collateral: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC (PoS)
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
};

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const CT_ABI = [
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved) returns ()",
];

// ── Load wallet ──
const walletData = JSON.parse(readFileSync("data/wallets/tim.json", "utf-8"));
const pk = walletData.privateKey.startsWith("0x")
  ? walletData.privateKey
  : `0x${walletData.privateKey}`;

const provider = new JsonRpcProvider(POLYGON_RPC, { chainId: 137, name: "matic" });
const signer = new Wallet(pk, provider);
console.log("Wallet:", signer.address);

// ── Check balances ──
console.log("\n── Balances ──");
const maticBalance = await provider.getBalance(signer.address);
console.log(`  POL/MATIC: ${formatUnits(maticBalance, 18)}`);

const usdc = new Contract(CONTRACTS.collateral, ERC20_ABI, signer);
const usdcBalance = await usdc.balanceOf(signer.address);
const usdcDecimals = await usdc.decimals();
console.log(`  USDC: ${formatUnits(usdcBalance, usdcDecimals)}`);

if (maticBalance.isZero()) {
  console.error("\n❌ No POL/MATIC for gas. Deposit ~0.01 POL to this wallet first.");
  process.exit(1);
}

// Check native USDC too
const nativeUsdcAddr = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const nativeUsdc = new Contract(nativeUsdcAddr, ERC20_ABI, signer);
const nativeUsdcBal = await nativeUsdc.balanceOf(signer.address);
const nativeUsdcDec = await nativeUsdc.decimals();
console.log(`  USDC (native): ${formatUnits(nativeUsdcBal, nativeUsdcDec)}`);

if (usdcBalance.isZero() && nativeUsdcBal.isZero()) {
  console.error(
    "\n❌ No USDC balance (neither bridged nor native). Deposit USDC to this wallet first.",
  );
  process.exit(1);
}

if (usdcBalance.isZero() && !nativeUsdcBal.isZero()) {
  console.log("\n⚠ You have native USDC but Polymarket uses bridged USDC.e (0x2791...).");
  console.log(
    "  You need to swap native USDC → USDC.e on a DEX (e.g. QuickSwap, Uniswap on Polygon).",
  );
  process.exit(1);
}

// ── Check and set USDC approvals for exchange contracts ──
const spenders = [
  { name: "CTF Exchange", address: CONTRACTS.exchange },
  { name: "Neg Risk CTF Exchange", address: CONTRACTS.negRiskExchange },
  { name: "Neg Risk Adapter", address: CONTRACTS.negRiskAdapter },
];

console.log("\n── USDC Approvals ──");
for (const spender of spenders) {
  const allowance = await usdc.allowance(signer.address, spender.address);
  const formatted = formatUnits(allowance, usdcDecimals);
  console.log(`  ${spender.name}: ${formatted} USDC approved`);

  if (allowance.isZero()) {
    console.log(`    → Approving max USDC for ${spender.name}...`);
    const tx = await usdc.approve(spender.address, MaxUint256);
    console.log(`    → TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`    → Confirmed in block ${receipt.blockNumber} ✓`);
  } else {
    console.log(`    → Already approved ✓`);
  }
}

// ── Check and set Conditional Tokens approval ──
console.log("\n── Conditional Tokens Approvals ──");
const ct = new Contract(CONTRACTS.conditionalTokens, CT_ABI, signer);

const ctSpenders = [
  { name: "CTF Exchange", address: CONTRACTS.exchange },
  { name: "Neg Risk CTF Exchange", address: CONTRACTS.negRiskExchange },
];

for (const spender of ctSpenders) {
  const approved = await ct.isApprovedForAll(signer.address, spender.address);
  console.log(`  ${spender.name}: ${approved ? "approved ✓" : "NOT approved"}`);

  if (!approved) {
    console.log(`    → Setting approval for ${spender.name}...`);
    const tx = await ct.setApprovalForAll(spender.address, true);
    console.log(`    → TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`    → Confirmed in block ${receipt.blockNumber} ✓`);
  }
}

console.log("\n✅ Wallet is set up for Polymarket trading!");
