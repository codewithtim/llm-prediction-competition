/**
 * Verify the proxy is actually routing traffic by checking our outbound IP.
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

// Check IP without proxy
console.log("── Direct (no proxy) ──");
const direct = await axios.get("https://api.ipify.org?format=json");
console.log("  IP:", direct.data.ip);

// Set proxy via axios.defaults (same as configureAxiosProxy)
const agent = new HttpsProxyAgent(proxyUrl);
axios.defaults.httpAgent = agent;
axios.defaults.httpsAgent = agent;

console.log("\n── Via axios.defaults.httpsAgent ──");
const viaDefaults = await axios.get("https://api.ipify.org?format=json");
console.log("  IP:", viaDefaults.data.ip);

console.log("\n── Via explicit httpsAgent ──");
const viaExplicit = await axios.get("https://api.ipify.org?format=json", { httpsAgent: agent });
console.log("  IP:", viaExplicit.data.ip);

console.log("\n── Via native fetch + agent ──");
const viaFetch = await fetch("https://api.ipify.org?format=json", { agent } as RequestInit);
const fetchData = await viaFetch.json();
console.log("  IP:", (fetchData as any).ip);

if (direct.data.ip === viaDefaults.data.ip) {
  console.log("\n⚠️  axios.defaults.httpsAgent is NOT routing through the proxy!");
} else {
  console.log("\n✅ axios.defaults.httpsAgent IS routing through the proxy");
}
