import type { GammaEvent, GammaEventParams, GammaMarket, GammaSport, GammaTag } from "./types.ts";

const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";

export function createGammaClient() {
  return {
    async getSports(): Promise<GammaSport[]> {
      const res = await fetch(`${GAMMA_BASE_URL}/sports`);
      if (!res.ok) throw new Error(`Gamma /sports failed: ${res.status}`);
      return res.json();
    },

    async getEvents(params: GammaEventParams = {}): Promise<GammaEvent[]> {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) qs.set(key, String(value));
      }
      const url = `${GAMMA_BASE_URL}/events?${qs}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Gamma /events failed: ${res.status}`);
      return res.json();
    },

    async getTags(): Promise<GammaTag[]> {
      const res = await fetch(`${GAMMA_BASE_URL}/tags`);
      if (!res.ok) throw new Error(`Gamma /tags failed: ${res.status}`);
      return res.json();
    },

    async getMarketById(marketId: string): Promise<GammaMarket | null> {
      const res = await fetch(`${GAMMA_BASE_URL}/markets?id=${marketId}`);
      if (!res.ok) throw new Error(`Gamma /markets failed: ${res.status}`);
      const data: GammaMarket[] = await res.json();
      return data.length > 0 ? (data[0] ?? null) : null;
    },
  };
}

export type GammaClient = ReturnType<typeof createGammaClient>;
