# Feature 4: Sports Data Integration

## Goal

Connect to API-Football v3 and fetch football fixture data and statistics. Map API responses to our domain `Fixture`, `TeamStats`, and `H2H` types. No database writes in this feature — that orchestration happens in the pipeline (Feature 10).

---

## Architecture

```
API-Football v3 (HTTP)
  GET /fixtures
  GET /standings
  GET /fixtures/headtohead
        │
        ▼
  FootballClient
  (typed HTTP client)
        │
        ▼
  mappers.ts
  (API response → Fixture)
  (standings → TeamStats)
  (h2h fixtures → H2H)
        │
        ▼
  Exported for use by pipeline
```

---

## Files to Create

### 1. `src/infrastructure/sports-data/types.ts` — Raw API-Football response types

Types representing what the API actually returns. These differ from our domain types in structure and naming.

```typescript
// All API-Football v3 responses wrap data in this envelope
export type ApiResponse<T> = {
  get: string;
  parameters: Record<string, string>;
  errors: Record<string, string> | [];
  results: number;
  paging: { current: number; total: number };
  response: T;
};

// GET /fixtures response item
export type ApiFixture = {
  fixture: {
    id: number;
    referee: string | null;
    timezone: string;
    date: string;              // ISO: "2025-02-01T12:30:00+00:00"
    timestamp: number;
    venue: { id: number | null; name: string | null; city: string | null };
    status: { long: string; short: string; elapsed: number | null; extra: number | null };
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string;
    season: number;
    round: string;
  };
  teams: {
    home: { id: number; name: string; logo: string; winner: boolean | null };
    away: { id: number; name: string; logo: string; winner: boolean | null };
  };
  goals: { home: number | null; away: number | null };
  score: {
    halftime: { home: number | null; away: number | null };
    fulltime: { home: number | null; away: number | null };
    extratime: { home: number | null; away: number | null };
    penalty: { home: number | null; away: number | null };
  };
};

// GET /standings response — nested array of standings entries
export type ApiStandingsResponse = {
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string;
    season: number;
    standings: ApiStandingEntry[][];  // Array of groups, each group is an array of entries
  };
};

export type ApiStandingEntry = {
  rank: number;
  team: { id: number; name: string; logo: string };
  points: number;
  goalsDiff: number;
  form: string | null;
  all:  { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
  home: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
  away: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
};

// Query params for GET /fixtures
export type FixtureParams = {
  league?: number;
  season?: number;
  from?: string;   // YYYY-MM-DD
  to?: string;     // YYYY-MM-DD
  date?: string;   // YYYY-MM-DD (single day)
  status?: string; // Comma-separated status codes
  id?: number;     // Single fixture ID
};
```

### 2. `src/infrastructure/sports-data/client.ts` — API-Football HTTP client

Plain `fetch` calls with the API key header. All methods return typed responses.

```typescript
import type {
  ApiFixture, ApiResponse, ApiStandingsResponse, FixtureParams,
} from "./types.ts";

const BASE_URL = "https://v3.football.api-sports.io";

export function createFootballClient(apiKey: string) {
  async function request<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<ApiResponse<T>> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      qs.set(key, String(value));
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
```

**Trade-off:** We use standings for team stats rather than `GET /teams/statistics` because:
1. Standings gives us the same core data (played, wins, draws, losses, goals, form, home/away splits) in a single call for all teams in a league.
2. `GET /teams/statistics` requires one call per team (expensive with 100 req/day free limit).
3. Standings also gives us points and rank, which are useful context.

### 3. `src/infrastructure/sports-data/mappers.ts` — API → domain type mappers

Pure functions that transform API responses to domain types.

```typescript
import type { Fixture, FixtureStatus } from "@domain/models/fixture.ts";
import type { H2H, TeamStats } from "@domain/contracts/statistics.ts";
import type { ApiFixture, ApiStandingEntry } from "./types.ts";

const STATUS_MAP: Record<string, FixtureStatus> = {
  NS: "scheduled", TBD: "scheduled",
  "1H": "in_progress", HT: "in_progress", "2H": "in_progress",
  ET: "in_progress", BT: "in_progress", P: "in_progress", LIVE: "in_progress",
  FT: "finished", AET: "finished", PEN: "finished", AWD: "finished", WO: "finished",
  PST: "postponed", SUSP: "postponed", INT: "postponed",
  CANC: "cancelled", ABD: "cancelled",
};

export function mapFixtureStatus(short: string): FixtureStatus {
  return STATUS_MAP[short] ?? "scheduled";
}

export function mapApiFixtureToFixture(raw: ApiFixture): Fixture {
  return {
    id: raw.fixture.id,
    league: {
      id: raw.league.id,
      name: raw.league.name,
      country: raw.league.country,
      season: raw.league.season,
    },
    homeTeam: {
      id: raw.teams.home.id,
      name: raw.teams.home.name,
      logo: raw.teams.home.logo,
    },
    awayTeam: {
      id: raw.teams.away.id,
      name: raw.teams.away.name,
      logo: raw.teams.away.logo,
    },
    date: raw.fixture.date,
    venue: raw.fixture.venue.name ?? null,
    status: mapFixtureStatus(raw.fixture.status.short),
  };
}

export function mapStandingToTeamStats(entry: ApiStandingEntry): TeamStats {
  return {
    teamId: entry.team.id,
    teamName: entry.team.name,
    played: entry.all.played,
    wins: entry.all.win,
    draws: entry.all.draw,
    losses: entry.all.lose,
    goalsFor: entry.all.goals.for,
    goalsAgainst: entry.all.goals.against,
    goalDifference: entry.goalsDiff,
    points: entry.points,
    form: entry.form,
    homeRecord: {
      played: entry.home.played,
      wins: entry.home.win,
      draws: entry.home.draw,
      losses: entry.home.lose,
      goalsFor: entry.home.goals.for,
      goalsAgainst: entry.home.goals.against,
    },
    awayRecord: {
      played: entry.away.played,
      wins: entry.away.win,
      draws: entry.away.draw,
      losses: entry.away.lose,
      goalsFor: entry.away.goals.for,
      goalsAgainst: entry.away.goals.against,
    },
  };
}

export function mapH2hFixturesToH2H(
  fixtures: ApiFixture[],
  homeTeamId: number,
  awayTeamId: number,
): H2H {
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;

  for (const f of fixtures) {
    if (f.goals.home === null || f.goals.away === null) continue;
    const isHomeTeamHome = f.teams.home.id === homeTeamId;
    const homeGoals = isHomeTeamHome ? f.goals.home : f.goals.away;
    const awayGoals = isHomeTeamHome ? f.goals.away : f.goals.home;

    if (homeGoals > awayGoals) homeWins++;
    else if (awayGoals > homeGoals) awayWins++;
    else draws++;
  }

  const recentMatches = fixtures.slice(0, 10).map((f) => ({
    date: f.fixture.date,
    homeTeam: f.teams.home.name,
    awayTeam: f.teams.away.name,
    homeGoals: f.goals.home ?? 0,
    awayGoals: f.goals.away ?? 0,
  }));

  return { totalMatches: fixtures.length, homeWins, awayWins, draws, recentMatches };
}
```

**Trade-off — H2H win counting:** The h2h endpoint returns fixtures where either team could be home or away. We track "home wins" and "away wins" relative to the team IDs passed in (our fixture's home/away teams), not the venue. This matches what the LLM needs for prediction context.

**Trade-off — `recentMatches` limit:** We take the first 10 from the API response. The API returns all h2h fixtures (could be 30+), but the LLM only needs recent context.

---

## Test Files

### 4. `tests/unit/infrastructure/sports-data/client.test.ts`

Mock `fetch` to test the HTTP client.

- Test `getFixtures()` builds correct URL with params and API key header
- Test `getHeadToHead()` formats h2h param correctly
- Test `getStandings()` passes league and season
- Test error handling on non-OK response

### 5. `tests/unit/infrastructure/sports-data/mappers.test.ts`

Pure function tests — no mocking needed.

- Test `mapFixtureStatus()` maps all known status codes
- Test `mapFixtureStatus()` defaults to "scheduled" for unknown codes
- Test `mapApiFixtureToFixture()` maps all fields correctly
- Test `mapApiFixtureToFixture()` handles null venue
- Test `mapStandingToTeamStats()` maps standings entry to TeamStats with home/away records
- Test `mapH2hFixturesToH2H()` counts wins/draws correctly when our "home" team played away
- Test `mapH2hFixturesToH2H()` limits recentMatches to 10
- Test `mapH2hFixturesToH2H()` skips fixtures with null goals

---

## Files to Modify

- **`src/infrastructure/sports-data/.gitkeep`** — delete (replaced by real files)

---

## Files NOT Modified

- **`src/domain/models/fixture.ts`** — existing types are sufficient
- **`src/domain/contracts/statistics.ts`** — `TeamStats`, `H2H` schemas already defined, API data maps cleanly
- **`src/shared/env.ts`** — `API_SPORTS_KEY` already declared
- **`src/infrastructure/database/`** — no DB changes in this feature

---

## Dependencies

- `fetch` — built into Bun, no install needed
- No new packages needed

---

## Open Questions (resolved)

1. **Use `GET /teams/statistics` or `GET /standings` for team stats?** → Standings. One call gets all teams in a league vs one call per team. The free plan's 100 req/day limit makes per-team calls impractical.

2. **How to handle the free plan's season restriction (2022-2024)?** → Build the code to work with any season. In production we'll use a paid plan. For testing, use 2024 season fixtures.

3. **Should we store API-Football raw responses?** → No. We map to domain types and only persist via the existing `fixturesRepo`. Raw responses are transient.

---

## Todo List

### Phase 1: Types
- [x] 1. Create `src/infrastructure/sports-data/types.ts` with `ApiResponse<T>`, `ApiFixture`, `ApiStandingsResponse`, `ApiStandingEntry`, `FixtureParams`
- [x] 2. Delete `src/infrastructure/sports-data/.gitkeep`

### Phase 2: Client
- [x] 3. Create `src/infrastructure/sports-data/client.ts` — `createFootballClient(apiKey)` with `getFixtures()`, `getHeadToHead()`, `getStandings()`
- [x] 4. Write `tests/unit/infrastructure/sports-data/client.test.ts` — mock fetch, test URL building, API key header, error handling

### Phase 3: Mappers
- [x] 5. Create `src/infrastructure/sports-data/mappers.ts` — `mapFixtureStatus()`, `mapApiFixtureToFixture()`, `mapStandingToTeamStats()`, `mapH2hFixturesToH2H()`
- [x] 6. Write `tests/unit/infrastructure/sports-data/mappers.test.ts` — status mapping, fixture mapping, standings mapping, h2h aggregation

### Phase 4: Verify
- [x] 7. Run `bun test` — all tests pass (98 tests, 0 failures)
- [x] 8. Run `bun run typecheck` — no TypeScript errors
- [x] 9. Run `bun run lint:fix` — no Biome errors
