/**
 * Set up ALL wallets for Polymarket trading:
 *   1. Send POL for gas from Tim's wallet to competitor wallets
 *   2. Swap native USDC → USDC.e via Uniswap V3 on each wallet
 *   3. Approve Polymarket exchange contracts to spend USDC.e
 *
 * Idempotent: skips steps already completed. Safe to re-run.
 *
 * Usage: bun run src/scripts/setup-all-wallets.ts [--dry-run]
 */

import { readdirSync, readFileSync } from "node:fs";
import { MaxUint256 } from "@ethersproject/constants";
import { Contract } from "@ethersproject/contracts";
import { JsonRpcProvider } from "@ethersproject/providers";
import { formatUnits, parseUnits } from "@ethersproject/units";
import { Wallet } from "@ethersproject/wallet";

const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";
const provider = new JsonRpcProvider(POLYGON_RPC, { chainId: 137, name: "matic" });

const dryRun = process.argv.includes("--dry-run");

// ── Contract addresses ──
const USDC_NATIVE = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const SWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const POLYMARKET_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const POLYMARKET_NEG_RISK_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const POLYMARKET_NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";
const CONDITIONAL_TOKENS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";

const GAS_AMOUNT = parseUnits("0.5", 18);
const GAS_OVERRIDES = {
  maxPriorityFeePerGas: parseUnits("50", "gwei"),
  maxFeePerGas: parseUnits("200", "gwei"),
};

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const SWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
];

const CT_ABI = [
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved) returns ()",
];

// ── Load wallets ──
const walletDir = "data/wallets";
const files = readdirSync(walletDir).filter((f) => f.endsWith(".json"));

type WalletInfo = { name: string; address: string; pk: string };
const wallets: WalletInfo[] = [];
let timWallet: WalletInfo | null = null;

for (const file of files) {
  const w = JSON.parse(readFileSync(`${walletDir}/${file}`, "utf-8"));
  const pk = w.privateKey.startsWith("0x") ? w.privateKey : `0x${w.privateKey}`;
  const info = { name: file.replace(".json", ""), address: w.walletAddress, pk };
  wallets.push(info);
  if (file === "tim.json") timWallet = info;
}

if (!timWallet) {
  console.error("tim.json not found");
  process.exit(1);
}

const timSigner = new Wallet(timWallet.pk, provider);
console.log(`Funder: ${timSigner.address}`);
console.log(`Dry run: ${dryRun}\n`);

async function sendAndWait(tx: any, _label: string) {
  console.log(`    TX: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`    Block ${receipt.blockNumber} ✓`);
  return receipt;
}

// ── Step 1: Send POL for gas ──
console.log("═══ Step 1: Fund competitor wallets with POL ═══\n");
const competitorWallets = wallets.filter((w) => w.name !== "tim");

let timNonce = await provider.getTransactionCount(timSigner.address, "latest");

for (const w of competitorWallets) {
  const balance = await provider.getBalance(w.address);

  if (balance.gte(GAS_AMOUNT)) {
    console.log(`  ${w.name}: ${formatUnits(balance, 18).substring(0, 8)} POL ✓`);
    continue;
  }

  const needed = GAS_AMOUNT.sub(balance);
  console.log(`  ${w.name}: sending ${formatUnits(needed, 18).substring(0, 6)} POL...`);

  if (!dryRun) {
    const tx = await timSigner.sendTransaction({
      to: w.address,
      value: needed,
      nonce: timNonce++,
      ...GAS_OVERRIDES,
    });
    await sendAndWait(tx, `POL → ${w.name}`);
  }
}

// ── Step 2: Swap native USDC → USDC.e ──
console.log("\n═══ Step 2: Swap native USDC → USDC.e ═══\n");

for (const w of wallets) {
  const signer = new Wallet(w.pk, provider);
  const usdcNative = new Contract(USDC_NATIVE, ERC20_ABI, signer);
  const usdcEContract = new Contract(USDC_E, ERC20_ABI, provider);

  const nativeBal = await usdcNative.balanceOf(w.address);
  const bridgedBal = await usdcEContract.balanceOf(w.address);

  if (nativeBal.isZero()) {
    const bal = formatUnits(bridgedBal, 6);
    console.log(`  ${w.name}: no native USDC (USDC.e: ${bal}) ✓`);
    continue;
  }

  console.log(`  ${w.name}: swapping ${formatUnits(nativeBal, 6)} USDC → USDC.e...`);
  if (dryRun) continue;

  let nonce = await provider.getTransactionCount(w.address, "latest");

  // Approve SwapRouter
  const allowance = await usdcNative.allowance(w.address, SWAP_ROUTER);
  if (allowance.lt(nativeBal)) {
    console.log(`    Approving SwapRouter...`);
    const approveTx = await usdcNative.approve(SWAP_ROUTER, MaxUint256, {
      nonce: nonce++,
      ...GAS_OVERRIDES,
    });
    await sendAndWait(approveTx, "approve");
  }

  // Swap
  const router = new Contract(SWAP_ROUTER, SWAP_ROUTER_ABI, signer);
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const minOut = nativeBal.mul(98).div(100);

  const swapTx = await router.exactInputSingle(
    {
      tokenIn: USDC_NATIVE,
      tokenOut: USDC_E,
      fee: 100,
      recipient: w.address,
      deadline,
      amountIn: nativeBal,
      amountOutMinimum: minOut,
      sqrtPriceLimitX96: 0,
    },
    { nonce: nonce++, ...GAS_OVERRIDES },
  );
  await sendAndWait(swapTx, "swap");

  const newBal = await usdcEContract.balanceOf(w.address);
  console.log(`    USDC.e balance: ${formatUnits(newBal, 6)}`);
}

// ── Step 3: Approve Polymarket contracts ──
console.log("\n═══ Step 3: Approve Polymarket contracts ═══\n");

const usdcSpenders = [
  { name: "Exchange", address: POLYMARKET_EXCHANGE },
  { name: "NegRiskExchange", address: POLYMARKET_NEG_RISK_EXCHANGE },
  { name: "NegRiskAdapter", address: POLYMARKET_NEG_RISK_ADAPTER },
];

const ctSpenders = [
  { name: "Exchange", address: POLYMARKET_EXCHANGE },
  { name: "NegRiskExchange", address: POLYMARKET_NEG_RISK_EXCHANGE },
];

for (const w of wallets) {
  const signer = new Wallet(w.pk, provider);
  const usdcE = new Contract(USDC_E, ERC20_ABI, signer);
  const ct = new Contract(CONDITIONAL_TOKENS, CT_ABI, signer);

  let nonce = await provider.getTransactionCount(w.address, "latest");
  const _needed = false;

  // Check what's needed first
  const tasks: Array<{ label: string; fn: () => Promise<any> }> = [];

  for (const sp of usdcSpenders) {
    const allowance = await usdcE.allowance(w.address, sp.address);
    if (allowance.isZero()) {
      tasks.push({
        label: `USDC.e → ${sp.name}`,
        fn: () => usdcE.approve(sp.address, MaxUint256, { nonce: nonce++, ...GAS_OVERRIDES }),
      });
    }
  }

  for (const sp of ctSpenders) {
    const approved = await ct.isApprovedForAll(w.address, sp.address);
    if (!approved) {
      tasks.push({
        label: `CT → ${sp.name}`,
        fn: () => ct.setApprovalForAll(sp.address, true, { nonce: nonce++, ...GAS_OVERRIDES }),
      });
    }
  }

  if (tasks.length === 0) {
    console.log(`  ${w.name}: all approved ✓`);
    continue;
  }

  console.log(`  ${w.name}: ${tasks.length} approvals needed`);
  if (dryRun) continue;

  for (const task of tasks) {
    console.log(`    ${task.label}...`);
    const tx = await task.fn();
    await sendAndWait(tx, task.label);
  }
}

// ── Final check ──
console.log("\n═══ Final balances ═══\n");
const usdcEContract = new Contract(USDC_E, ERC20_ABI, provider);
for (const w of wallets) {
  const pol = await provider.getBalance(w.address);
  const usdcE = await usdcEContract.balanceOf(w.address);
  console.log(
    `  ${w.name.padEnd(22)} POL: ${formatUnits(pol, 18).substring(0, 8).padStart(8)}  USDC.e: ${formatUnits(usdcE, 6).padStart(8)}`,
  );
}

console.log("\n✅ Done!");
