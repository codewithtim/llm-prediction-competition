import type { ApiFixture, ApiResponse, ApiStandingsResponse, FixtureParams } from "./types.ts";

const BASE_URL = "https://v3.football.api-sports.io";

export function createFootballClient(apiKey: string) {
  async function request<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<ApiResponse<T>> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const url = `${BASE_URL}${path}?${qs}`;
    const res = await fetch(url, {
      headers: { "x-apisports-key": apiKey },
    });
    if (!res.ok) throw new Error(`API-Football ${path} failed: ${res.status}`);
    return res.json();
  }

  return {
    async getFixtures(params: FixtureParams) {
      return request<ApiFixture[]>("/fixtures", params as Record<string, string | number>);
    },

    async getHeadToHead(teamId1: number, teamId2: number) {
      return request<ApiFixture[]>("/fixtures/headtohead", { h2h: `${teamId1}-${teamId2}` });
    },

    async getStandings(league: number, season: number) {
      return request<ApiStandingsResponse[]>("/standings", { league, season });
    },
  };
}

export type FootballClient = ReturnType<typeof createFootballClient>;
