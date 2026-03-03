import type {
  ApiFixture,
  ApiInjury,
  ApiLeagueResponse,
  ApiPlayerResponse,
  ApiResponse,
  ApiStandingsResponse,
  ApiTeamStatisticsResponse,
  FixtureParams,
  PlayerParams,
} from "./types.ts";

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

    async getInjuries(fixtureId: number) {
      return request<ApiInjury[]>("/injuries", { fixture: fixtureId });
    },

    async getTeamStatistics(teamId: number, leagueId: number, season: number, date?: string) {
      return request<ApiTeamStatisticsResponse>("/teams/statistics", {
        team: teamId,
        league: leagueId,
        season,
        ...(date ? { date } : {}),
      });
    },

    async getLeagues(params: { id?: number; current?: boolean }) {
      return request<ApiLeagueResponse[]>(
        "/leagues",
        params as Record<string, string | number | boolean>,
      );
    },

    async getPlayers(params: PlayerParams) {
      return request<ApiPlayerResponse[]>("/players", params as Record<string, string | number>);
    },

    async getAllPlayers(teamId: number, season: number): Promise<ApiPlayerResponse[]> {
      const MAX_PAGES = 10;
      const all: ApiPlayerResponse[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const resp = await request<ApiPlayerResponse[]>("/players", { team: teamId, season, page });
        totalPages = resp.paging.total;
        all.push(...resp.response);
        page++;
      } while (page <= totalPages && page <= MAX_PAGES);
      return all;
    },
  };
}

export type FootballClient = ReturnType<typeof createFootballClient>;
