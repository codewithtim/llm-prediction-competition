import type { GammaEvent, GammaEventParams, GammaSport } from "./types.ts";

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
  };
}

export type GammaClient = ReturnType<typeof createGammaClient>;
