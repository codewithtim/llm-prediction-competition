import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

/**
 * Patches the global axios defaults so all requests (including those from
 * @polymarket/clob-client) route through the given HTTP proxy.
 */
export function configureAxiosProxy(proxyUrl: string): void {
  const agent = new HttpsProxyAgent(proxyUrl);
  axios.defaults.httpAgent = agent;
  axios.defaults.httpsAgent = agent;
}

/**
 * Returns a fetch-compatible function that routes requests through the
 * given HTTP proxy using https-proxy-agent.
 */
/**
 * Returns a fetch-compatible function that routes requests through the
 * given HTTP proxy using https-proxy-agent.
 */
export function createProxyFetch(
  proxyUrl: string,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const agent = new HttpsProxyAgent(proxyUrl);
  return (input: string | URL | Request, init?: RequestInit) => {
    return fetch(input, { ...init, ...({ agent } as Record<string, unknown>) });
  };
}
