import { readFileSync } from "node:fs";
import { HttpsProxyAgent } from "https-proxy-agent";

// Load PROXY_URL from .env manually
const envContent = readFileSync(".env", "utf-8");
const match = envContent.match(/^PROXY_URL=(.+)$/m);
const proxyUrl = match?.[1];

if (!proxyUrl) {
  console.error("❌ PROXY_URL not set in .env");
  process.exit(1);
}

console.log("Using proxy:", proxyUrl.replace(/\/\/.*@/, "//<redacted>@"));
console.log("Testing connection to Polymarket CLOB API...\n");

const agent = new HttpsProxyAgent(proxyUrl);

const res = await fetch("https://clob.polymarket.com/markets?limit=1", {
  agent,
} as RequestInit);

console.log("Status:", res.status, res.statusText);
const data = await res.json();
console.log("Response preview:", JSON.stringify(data).substring(0, 400));
console.log("\n✅ Proxy is working!");
