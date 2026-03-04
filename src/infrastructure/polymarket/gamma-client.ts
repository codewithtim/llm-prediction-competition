import type { GammaEvent, GammaEventParams, GammaMarket, GammaSport, GammaTag } from "./types.ts";

const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";

async function gammaFetch(endpoint: string): Promise<Response> {
  const res = await fetch(`${GAMMA_BASE_URL}${endpoint}`);
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.text();
      if (body) detail = `: ${body}`;
    } catch {}
    throw new Error(`Gamma ${endpoint} failed (HTTP ${res.status})${detail}`);
  }
  return res;
}

export function createGammaClient() {
  return {
    async getSports(): Promise<GammaSport[]> {
      const res = await gammaFetch("/sports");
      return res.json();
    },

    async getEvents(params: GammaEventParams = {}): Promise<GammaEvent[]> {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) qs.set(key, String(value));
      }
      const res = await gammaFetch(`/events?${qs}`);
      return res.json();
    },

    async getTags(): Promise<GammaTag[]> {
      const res = await gammaFetch("/tags");
      return res.json();
    },

    async getMarketById(marketId: string): Promise<GammaMarket | null> {
      const res = await gammaFetch(`/markets?id=${marketId}`);
      const data: GammaMarket[] = await res.json();
      return data.length > 0 ? (data[0] ?? null) : null;
    },
  };
}

export type GammaClient = ReturnType<typeof createGammaClient>;
