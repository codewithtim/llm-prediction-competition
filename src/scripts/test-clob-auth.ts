/**
 * Test CLOB API: verify proxy works for order-related endpoints.
 *
 * Usage: bun run --env-file .env src/scripts/test-clob-auth.ts
 */

import { readFileSync } from "node:fs";
import { Wallet } from "@ethersproject/wallet";
import { ClobClient } from "@polymarket/clob-client";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

const CLOB_BASE_URL = "https://clob.polymarket.com";
const CHAIN_ID = 137;

const wallet = JSON.parse(readFileSync("data/wallets/wt-claude-opus-46.json", "utf-8"));
console.log("Wallet:", wallet.walletAddress);

const proxyUrl = process.env.PROXY_URL;
if (!proxyUrl) {
  console.error("No PROXY_URL set");
  process.exit(1);
}

const agent = new HttpsProxyAgent(proxyUrl);
axios.defaults.httpAgent = agent;
axios.defaults.httpsAgent = agent;
axios.defaults.timeout = 15000;
console.log("Proxy configured\n");

const signer = new Wallet(wallet.privateKey);
const creds = {
  key: wallet.apiKey,
  secret: wallet.apiSecret,
  passphrase: wallet.apiPassphrase,
};
const clob = new ClobClient(CLOB_BASE_URL, CHAIN_ID, signer, creds, 0);

// Test getTickSize — public endpoint used before order placement
console.log("── getTickSize (public) ──");
try {
  // Use a real active token ID from a football market
  const markets = await axios.get(`${CLOB_BASE_URL}/markets?limit=1`);
  const firstMarket = markets.data?.data?.[0] || markets.data?.[0];
  if (firstMarket) {
    console.log("  Market:", firstMarket.condition_id?.substring(0, 20), "...");
    const tokenIds = firstMarket.tokens?.map((t: any) => t.token_id);
    if (tokenIds?.[0]) {
      const tickSize = await clob.getTickSize(tokenIds[0]);
      console.log("  TickSize:", tickSize);

      const negRisk = await clob.getNegRisk(tokenIds[0]);
      console.log("  NegRisk:", negRisk);
    }
  }
} catch (err: any) {
  console.log("  Error:", err.message?.substring(0, 200));
}

// Test getOpenOrders — L2 auth, trading-related
console.log("\n── getOpenOrders (L2 auth) ──");
try {
  const orders = await clob.getOpenOrders();
  console.log("  Result:", JSON.stringify(orders).substring(0, 200));
} catch (err: any) {
  console.log("  Error:", err.message?.substring(0, 300));
}

// Test cancelAll — L2 auth, trading operation
console.log("\n── cancelAll (L2 auth, DELETE) ──");
try {
  const result = await clob.cancelAll();
  console.log("  Result:", JSON.stringify(result).substring(0, 200));
} catch (err: any) {
  console.log("  Error:", err.message?.substring(0, 300));
}

// Test raw POST to /order with dummy data to see the error type
console.log("\n── raw POST /order (should fail with business error, not 417) ──");
try {
  const res = await axios.post(
    `${CLOB_BASE_URL}/order`,
    { dummy: true },
    {
      headers: {
        "Content-Type": "application/json",
        POLY_ADDRESS: wallet.walletAddress,
        POLY_API_KEY: wallet.apiKey,
        POLY_PASSPHRASE: wallet.apiPassphrase,
        POLY_SIGNATURE: "fake",
        POLY_TIMESTAMP: Math.floor(Date.now() / 1000).toString(),
      },
    },
  );
  console.log("  Status:", res.status, "Data:", JSON.stringify(res.data).substring(0, 200));
} catch (err: any) {
  console.log("  HTTP", err.response?.status, err.response?.statusText);
  console.log("  Body:", JSON.stringify(err.response?.data).substring(0, 300));
}

console.log("\nDone.");
