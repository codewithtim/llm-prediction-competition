/**
 * Test whether axios.defaults.httpsAgent actually routes through the proxy.
 * This mimics exactly what the CLOB client does.
 */

import { readFileSync } from "node:fs";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

const envContent = readFileSync(".env", "utf-8");
const match = envContent.match(/^PROXY_URL=(.+)$/m);
const proxyUrl = match?.[1];

if (!proxyUrl) {
  console.error("PROXY_URL not set in .env");
  process.exit(1);
}

console.log("Proxy:", proxyUrl.replace(/\/\/.*@/, "//<redacted>@"));

// Step 1: Test WITHOUT proxy (should be geo-blocked)
console.log("\n── WITHOUT proxy ──");
try {
  const res = await axios({ method: "GET", url: "https://clob.polymarket.com/markets?limit=1" });
  console.log("  Status:", res.status);
  console.log("  Data:", JSON.stringify(res.data).substring(0, 200));
} catch (err: any) {
  console.log("  Error:", err.response?.status, err.response?.data || err.message);
}

// Step 2: Set axios.defaults (same as configureAxiosProxy)
const agent = new HttpsProxyAgent(proxyUrl);
axios.defaults.httpAgent = agent;
axios.defaults.httpsAgent = agent;
console.log("\n── Set axios.defaults.httpsAgent ──");

// Step 3: Test WITH proxy via defaults
console.log("\n── WITH proxy (via axios.defaults) ──");
try {
  const res = await axios({ method: "GET", url: "https://clob.polymarket.com/markets?limit=1" });
  console.log("  Status:", res.status);
  console.log("  Data:", JSON.stringify(res.data).substring(0, 200));
} catch (err: any) {
  console.log("  Error:", err.response?.status, err.response?.data || err.message);
}

// Step 4: Test WITH proxy passed explicitly
console.log("\n── WITH proxy (explicit httpsAgent) ──");
try {
  const res = await axios({
    method: "GET",
    url: "https://clob.polymarket.com/markets?limit=1",
    httpsAgent: agent,
  });
  console.log("  Status:", res.status);
  console.log("  Data:", JSON.stringify(res.data).substring(0, 200));
} catch (err: any) {
  console.log("  Error:", err.response?.status, err.response?.data || err.message);
}
