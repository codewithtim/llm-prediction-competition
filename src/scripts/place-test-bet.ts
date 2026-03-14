/**
 * Place a $5 test bet on an active Polymarket BTC Up/Down market.
 *
 * Usage: bun run --env-file .env src/scripts/place-test-bet.ts [--direct]
 */

import { readFileSync } from "node:fs";
import { Wallet } from "@ethersproject/wallet";
import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

const CLOB_BASE_URL = "https://clob.polymarket.com";
const CHAIN_ID = 137;

// Active BTC Up/Down market (March 9, 3:15AM-3:20AM ET)
const UP_TOKEN = "82778641869988497130342943568609392435455319706704265881849688635552544139781";
const CONDITION_ID = "0x774c0f7119535cc8cfade8650ee56169809ff016378d91c0de439724814b86c9";

// ── Step 1: Load wallet ──
const wallet = JSON.parse(readFileSync("data/wallets/tim.json", "utf-8"));
const pk = wallet.privateKey.startsWith("0x") ? wallet.privateKey : `0x${wallet.privateKey}`;
const signer = new Wallet(pk);
console.log("Wallet:", signer.address);

// ── Step 2: Derive API creds (direct — /auth endpoints flaky through proxy) ──
console.log("\nDeriving API credentials...");
axios.defaults.timeout = 15000;
const clobForAuth = new ClobClient(CLOB_BASE_URL, CHAIN_ID, signer);
let creds: { key: string; secret: string; passphrase: string };
try {
  creds = await clobForAuth.createOrDeriveApiKey();
  console.log("  API Key:", creds.key);
} catch (err: any) {
  console.error("Failed to derive API key:", err.message);
  process.exit(1);
}

// ── Step 3: Proxy ──
const useProxy = !process.argv.includes("--direct");
const proxyUrl = process.env.PROXY_URL;
if (proxyUrl && useProxy) {
  const agent = new HttpsProxyAgent(proxyUrl);
  axios.defaults.httpAgent = agent;
  axios.defaults.httpsAgent = agent;
  console.log("Proxy enabled");
} else {
  console.log("Mode: DIRECT");
}

// ── Step 4: Create authenticated client ──
const clob = new ClobClient(CLOB_BASE_URL, CHAIN_ID, signer, creds, 0);

// Check market is accepting orders
console.log("\nChecking market...");
const market = await clob.getMarket(CONDITION_ID);
console.log(
  `  Active: ${market?.active}  Closed: ${market?.closed}  Accepting: ${market?.accepting_orders}`,
);
if (market?.closed || !market?.accepting_orders) {
  console.error("Market is closed or not accepting orders");
  process.exit(1);
}

// Get tick size + neg risk
console.log("\nGetting market params...");
const tickSize = await clob.getTickSize(UP_TOKEN);
const negRisk = await clob.getNegRisk(UP_TOKEN);
console.log(`  Tick size: ${tickSize}, Neg risk: ${negRisk}`);

// ── Step 5: Place $5 bet on "Up" ──
const BET_AMOUNT = 5;
const PRICE = 0.5;
const SIZE = BET_AMOUNT / PRICE;

console.log(`\nPlacing $${BET_AMOUNT} BUY on "Up" at ${PRICE}...`);
console.log(`  Size: ${SIZE} shares`);

try {
  const result = await clob.createAndPostOrder(
    {
      tokenID: UP_TOKEN,
      price: PRICE,
      size: SIZE,
      side: Side.BUY,
    },
    { tickSize, negRisk },
    OrderType.GTC,
  );

  if (result && typeof result === "object" && "error" in result) {
    console.error("\n❌ Order rejected:", JSON.stringify(result, null, 2));
  } else {
    console.log("\n✅ Order placed!", JSON.stringify(result, null, 2));
  }
} catch (err: any) {
  console.error("\n❌ Order failed:", err.message);
}

console.log("\nDone.");
