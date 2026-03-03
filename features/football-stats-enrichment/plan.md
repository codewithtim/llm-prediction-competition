# Plan: Football Stats Enrichment

**Date:** 2026-03-03
**Status:** Complete

---

## Overview

Our prediction engines currently receive a narrow slice of the data available from API-Football v3. We fetch **standings** (league table stats) and **head-to-head** (historical match results) — that's it. The API offers far richer pre-match data that could meaningfully improve LLM predictions: injury/suspension lists, detailed team season statistics (goals by minute, clean sheets, formations, under/over history), and player season statistics (goals, assists, ratings, shots, passes, dribbles per player).

This plan categorises every API-Football v3 endpoint by its usefulness for our pre-match prediction system, recommends which data to **store in our database** versus **pass through to LLMs at prediction time**, and lays out the implementation to enrich the `Statistics` contract that engines receive.

---

## API-Football v3 — Complete Endpoint Inventory

Below is every endpoint from `docs/api-football/openapi.yaml`, grouped into tiers by value for **pre-match prediction**.

### Tier 1 — High value, should use

| Endpoint | What it returns | Why it matters | Calls needed |
|---|---|---|---|
| **`/injuries?fixture={id}`** | List of players per fixture: name, type (`Missing Fixture` or `Questionable`), reason (e.g. "Knee Injury", "Suspended", "Illness"), team | Key player absences materially affect match outcomes. An LLM knowing "Lewandowski is out with a knee injury" can adjust predictions. We currently have zero injury context. Updated every 4 hours. | 1 per fixture |
| **`/teams/statistics?team={id}&league={id}&season={year}`** | Full season stats: form string (whole season), fixtures (played/W/D/L by home/away/total), goals for/against (totals + averages by home/away), **goals by minute** (0-15, 16-30, ..., 91-105, 106-120 with percentages), **under/over history** (0.5, 1.5, 2.5, 3.5, 4.5 — matches over/under each line), biggest streak/wins/losses, **clean sheets** (home/away/total), **failed to score** (home/away/total), **penalty record** (scored/missed), **most-used formations**, **cards by minute** (yellow/red). Supports `date` param to compute stats up to a point in the season. | Much richer than standings. Goals-by-minute tells you if a team scores early vs late. Under/over history is directly relevant for total-goals markets. Clean sheet / failed-to-score rates help predict exact outcomes. Formations indicate tactical approach. Updated twice daily. | 2 per fixture (1 per team) |
| **`/players?team={id}&season={year}`** | Season-level player stats: appearances, lineups, minutes, position, **rating**, shots (total/on target), goals (total/assists), passes (total/key/accuracy), tackles/blocks/interceptions, duels, dribbles (attempts/success), fouls, cards, penalties. Also includes `injured` boolean and player metadata. Paginated (20/page). | Pre-match player-level context. Lets an LLM reason about squad strength — e.g. "home team's top scorer has 15 goals and 8.1 rating vs away's top scorer with 8 goals and 7.2 rating". Combined with injuries, the LLM can assess the impact of absent players. Updated several times per week. | 2-4 per team (paginated), so 4-8 per fixture |

### Tier 2 — Moderate value, use selectively or in Phase 2

| Endpoint | What it returns | Why it matters | Calls needed |
|---|---|---|---|
| `/fixtures/statistics?fixture={id}` | Per-team match stats from finished fixtures: Shots on/off Goal, Total Shots, Blocked Shots, Shots inside/outside box, Fouls, Corner Kicks, Offsides, Ball Possession, Yellow/Red Cards, Goalkeeper Saves, Total/Accurate Passes, Pass %, **expected_goals** (from 2024+), **goals_prevented** | Post-match data only. Could aggregate last N finished fixtures to build rolling performance averages. xG data is particularly valuable. | N calls for last N fixtures — expensive |
| `/fixtures/lineups?fixture={id}` | Formation, starting XI (player name, position, grid), substitutes, coach | Only available 20-40 mins before kickoff. Timing-sensitive for our pipeline. | 1 per fixture |
| `/fixtures/events?fixture={id}` | Goals, cards, substitutions, VAR decisions with timestamps from finished matches | Post-match. Could derive features like "3 red cards in last 5 matches". | N calls — expensive |
| `/predictions?fixture={id}` | API's own algorithmic predictions (winner, under/over, comparison stats). Uses 6 algorithms including poisson distribution. | **Will be used as a separate competitor**, not as input to our engines. Not part of this enrichment plan. | N/A |

### Tier 3 — Low value or not relevant for pre-match prediction

| Endpoint | Why skip |
|---|---|
| `/standings` | **Already used.** Provides the TeamStats we currently have. |
| `/fixtures/headtohead` | **Already used.** Provides H2H. |
| `/fixtures` | **Already used.** Provides fixture metadata. |
| `/fixtures/players` | **In-play/post-match** player stats per fixture — not pre-match. |
| `/odds`, `/odds/live`, `/odds/*` | Redundant — we already have Polymarket odds as our betting market. |
| `/players/topscorers`, `/players/topassists` | League-level top-20 rankings. The `/players?team=X` call already gives us per-team player stats which is more relevant. |
| `/players/topyellowcards`, `/players/topredcards` | Niche, low predictive value. |
| `/players/squads` | Current squad list (name, position, number) — no statistics. The `/players` endpoint gives us the same players plus their stats. |
| `/players/profiles`, `/players/seasons`, `/players/teams` | Metadata lookups, not statistical. |
| `/coachs` | Coach career info — marginal impact on match prediction. |
| `/transfers` | Seasonal data, not fixture-relevant. |
| `/trophies`, `/sidelined` | Historical records, minimal prediction value. |
| `/venues` | Already captured in fixture data. |
| `/timezone`, `/countries`, `/leagues`, `/leagues/seasons`, `/teams`, `/teams/seasons`, `/teams/countries`, `/fixtures/rounds` | Reference/lookup data, not predictive. |

---

## Approach

### What to add — the enrichment calls

For each fixture at prediction time, add these API calls on top of the existing 2 (standings + h2h):

1. **`/injuries?fixture={id}`** — 1 call per fixture
2. **`/teams/statistics?team={id}&league={id}&season={year}`** — 2 calls per fixture (1 per team)
3. **`/players?team={id}&season={year}`** — 4-8 calls per fixture (paginated, 2-4 pages per team)

This brings us from ~3 calls per fixture to ~10-13 calls per fixture. With 2-5 fixtures per prediction run, that's 20-65 calls. On a paid plan this is comfortable. On a free plan (100/day) this limits us to ~8-10 fixtures/day which may be tight — but acceptable for now.

### What to store vs pass through

**Store in DB (cache for reuse):**
- **Team statistics** from `/teams/statistics` — these are season-level aggregates that change at most twice daily. Cache them per team+league+season with a staleness check. Avoids refetching the same team stats when they play multiple fixtures in the same prediction run window.
- **Player statistics** from `/players` — season-level aggregates updated several times per week. Cache per team+league+season. Very expensive to re-fetch (paginated), so caching is essential.

**Fetch fresh each run (don't cache):**
- **Injuries** from `/injuries` — fixture-specific and time-sensitive (updated every 4 hours). Always fetch fresh.

**Pass to LLMs (enrich `Statistics` contract):**
- Everything currently passed (TeamStats from standings, H2H, Markets)
- Injuries: list of missing/questionable players per team with reasons
- Team season stats: clean sheets, failed to score, goals by minute distribution, under/over history, biggest streaks, penalty record, preferred formations
- Player stats: top players per team by rating with key stats (goals, assists, minutes, rating)

### Trade-offs

| Decision | Chose | Alternative | Why |
|---|---|---|---|
| Include `/teams/statistics` now | Yes — 2 calls per fixture | Defer to Phase 2 | Under/over history, clean sheets, goals by minute are directly relevant to betting markets we target (winner, total goals). Worth the API cost. |
| Include `/players` now | Yes — 4-8 calls per fixture | Defer to Phase 2 | Player-level context (top scorers, ratings) combined with injury data gives the LLM much richer reasoning ability. Paginated cost is the main downside. |
| Cache team/player stats in DB | Yes — new cache tables | Fetch fresh every time | `/players` pagination is 4-8 calls per team. Without caching, two fixtures with the same team would double the cost. Cache with a staleness TTL (e.g. 24 hours). |
| Summarise player stats before passing to LLM | Yes — top N players per team | Pass all ~25-30 players | LLM context windows have limits and more data isn't always better. Pass top 5-8 players per team ranked by rating, plus any injured players regardless of rank. |
| Skip `/fixtures/statistics` aggregation | Yes — defer to Phase 2 | Fetch last 5 fixtures and compute rolling averages | 10 extra calls per fixture is expensive. The team season stats from `/teams/statistics` already capture overall performance trends. |
| Skip `/predictions` for engine enrichment | Yes — separate competitor | Include as input signal | User wants it as a standalone competitor that competes against our LLM-tuned engines, not as an input feature. |
| Pass `date` param to `/teams/statistics` | Yes — always pass `fixture.date` | Omit it (get full-season stats) | Without `date`, the API returns stats including matches played after the fixture being predicted, which is data leakage. Always scope stats to the fixture date. |
| Pagination in `FootballClient.getAllPlayers` | Yes — handle in client | Handle in pipeline with loop | Pagination is transport-level infrastructure. The pipeline should call one method and receive a full list. Keeping it in the client layer is consistent with `getHeadToHead` encapsulating its own query. |

---

## Changes Required

### `src/domain/contracts/statistics.ts`

Extend the `Statistics` type with optional enrichment fields. Existing engines continue to work unchanged.

```typescript
// New schemas
export const injurySchema = z.object({
  playerId: z.number(),
  playerName: z.string(),
  type: z.string(), // Keep permissive — API can return "Injury", "Illness" etc. beyond just "Missing Fixture" | "Questionable"
  reason: z.string(),
  teamId: z.number(),
});

export const goalsByMinuteSchema = z.object({
  "0-15": z.object({ total: z.number().nullable(), percentage: z.string().nullable() }),
  "16-30": z.object({ total: z.number().nullable(), percentage: z.string().nullable() }),
  "31-45": z.object({ total: z.number().nullable(), percentage: z.string().nullable() }),
  "46-60": z.object({ total: z.number().nullable(), percentage: z.string().nullable() }),
  "61-75": z.object({ total: z.number().nullable(), percentage: z.string().nullable() }),
  "76-90": z.object({ total: z.number().nullable(), percentage: z.string().nullable() }),
  "91-105": z.object({ total: z.number().nullable(), percentage: z.string().nullable() }),
  "106-120": z.object({ total: z.number().nullable(), percentage: z.string().nullable() }),
});

export const underOverSchema = z.object({
  "0.5": z.object({ over: z.number(), under: z.number() }),
  "1.5": z.object({ over: z.number(), under: z.number() }),
  "2.5": z.object({ over: z.number(), under: z.number() }),
  "3.5": z.object({ over: z.number(), under: z.number() }),
  "4.5": z.object({ over: z.number(), under: z.number() }),
});

export const teamSeasonStatsSchema = z.object({
  // NOTE: this `form` is the whole-season form string (e.g. "WWDLW...").
  // It is DIFFERENT from `teamStatsSchema.form` which comes from standings and covers only recent matches.
  // Do not use this to replace or extend the existing formDiff feature — create a separate seasonFormDiff if needed.
  form: z.string().nullable(),
  // fixtures.played is retained as the canonical denominator for rate calculations (cleanSheets, failedToScore).
  // Always use this rather than stats.homeTeam.played to avoid mixing sources.
  fixtures: z.object({
    played: z.object({ home: z.number(), away: z.number(), total: z.number() }),
  }),
  cleanSheets: z.object({ home: z.number(), away: z.number(), total: z.number() }),
  failedToScore: z.object({ home: z.number(), away: z.number(), total: z.number() }),
  biggestStreak: z.object({ wins: z.number(), draws: z.number(), loses: z.number() }),
  penaltyRecord: z.object({ scored: z.number(), missed: z.number(), total: z.number() }),
  preferredFormations: z.array(z.object({ formation: z.string(), played: z.number() })),
  goalsForByMinute: goalsByMinuteSchema,
  goalsAgainstByMinute: goalsByMinuteSchema,
  goalsForUnderOver: underOverSchema,
  goalsAgainstUnderOver: underOverSchema,
});

export const playerSeasonStatsSchema = z.object({
  playerId: z.number(),
  name: z.string(),
  position: z.string().nullable(),
  rating: z.number().nullable(),
  appearances: z.number(),
  minutes: z.number(),
  goals: z.number(),
  assists: z.number(),
  shotsTotal: z.number().nullable(),
  shotsOnTarget: z.number().nullable(),
  passesKey: z.number().nullable(),
  passAccuracy: z.number().nullable(),
  dribblesSuccess: z.number().nullable(),
  dribblesAttempts: z.number().nullable(),
  yellowCards: z.number(),
  redCards: z.number(),
  injured: z.boolean(),
});

// NOTE: this replaces the existing statisticsSchema definition in statistics.ts entirely.
// The existing TeamStats, H2H, MarketContext, Statistics types continue to be exported via z.infer<> —
// no downstream changes needed since the new fields are optional.
export const statisticsSchema = z.object({
  fixtureId: z.number(),
  league: z.object({ id: z.number(), name: z.string(), country: z.string(), season: z.number() }),
  homeTeam: teamStatsSchema,
  awayTeam: teamStatsSchema,
  h2h: h2hSchema,
  markets: z.array(marketContextSchema).min(1),
  // NEW — optional so existing engines don't break
  injuries: z.array(injurySchema).optional(),
  homeTeamSeasonStats: teamSeasonStatsSchema.optional(),
  awayTeamSeasonStats: teamSeasonStatsSchema.optional(),
  homeTeamPlayers: z.array(playerSeasonStatsSchema).optional(),
  awayTeamPlayers: z.array(playerSeasonStatsSchema).optional(),
});
```

### `src/infrastructure/sports-data/types.ts`

Add raw API response types for the new endpoints.

```typescript
// GET /injuries response item
export type ApiInjury = {
  player: {
    id: number;
    name: string;
    photo: string;
    type: string; // "Missing Fixture" | "Questionable"
    reason: string;
  };
  team: { id: number; name: string; logo: string };
  fixture: { id: number; timezone: string; date: string; timestamp: number };
  league: { id: number; season: number; name: string; country: string };
};

// GET /teams/statistics response — note: response is a single object, not array
// The full shape is already typed in the existing ApiStandingsResponse,
// but team/statistics returns a richer object. Key additional fields:
export type ApiTeamStatisticsResponse = {
  league: { id: number; name: string; country: string; season: number };
  team: { id: number; name: string; logo: string };
  form: string;
  fixtures: {
    played: { home: number; away: number; total: number };
    wins: { home: number; away: number; total: number };
    draws: { home: number; away: number; total: number };
    loses: { home: number; away: number; total: number };
  };
  goals: {
    for: {
      total: { home: number; away: number; total: number };
      average: { home: string; away: string; total: string };
      minute: Record<string, { total: number | null; percentage: string | null }>;
      under_over: Record<string, { over: number; under: number }>;
    };
    against: {
      total: { home: number; away: number; total: number };
      average: { home: string; away: string; total: string };
      minute: Record<string, { total: number | null; percentage: string | null }>;
      under_over: Record<string, { over: number; under: number }>;
    };
  };
  biggest: {
    streak: { wins: number; draws: number; loses: number };
    wins: { home: string; away: string };
    loses: { home: string; away: string };
    goals: { for: { home: number; away: number }; against: { home: number; away: number } };
  };
  clean_sheet: { home: number; away: number; total: number };
  failed_to_score: { home: number; away: number; total: number };
  penalty: {
    scored: { total: number; percentage: string };
    missed: { total: number; percentage: string };
    total: number;
  };
  lineups: Array<{ formation: string; played: number }>;
  cards: {
    yellow: Record<string, { total: number | null; percentage: string | null }>;
    red: Record<string, { total: number | null; percentage: string | null }>;
  };
};

// GET /players response item
export type ApiPlayerResponse = {
  player: {
    id: number;
    name: string;
    firstname: string;
    lastname: string;
    age: number;
    nationality: string;
    height: string | null;
    weight: string | null;
    injured: boolean;
    photo: string;
  };
  statistics: Array<{
    team: { id: number; name: string; logo: string };
    league: { id: number; name: string; country: string; season: number };
    games: {
      appearences: number | null;  // note: API typo "appearences"
      lineups: number | null;
      minutes: number | null;
      number: number | null;
      position: string | null;
      rating: string | null;
      captain: boolean;
    };
    substitutes: { in: number; out: number; bench: number };
    shots: { total: number | null; on: number | null };
    goals: { total: number | null; conceded: number | null; assists: number | null; saves: number | null };
    passes: { total: number | null; key: number | null; accuracy: number | null };
    tackles: { total: number | null; blocks: number | null; interceptions: number | null };
    duels: { total: number | null; won: number | null };
    dribbles: { attempts: number | null; success: number | null; past: number | null };
    fouls: { drawn: number | null; committed: number | null };
    cards: { yellow: number; yellowred: number; red: number };
    penalty: { won: number | null; commited: number | null; scored: number; missed: number; saved: number | null };
  }>;
};

// Params for player queries
export type PlayerParams = {
  team?: number;
  league?: number;
  season?: number;
  id?: number;
  page?: number;
};
```

### `src/infrastructure/sports-data/client.ts`

Add four new methods to the football client. Pagination is handled by `getAllPlayers` at the client layer — the pipeline should call that, not `getPlayers` directly.

```typescript
async getInjuries(fixtureId: number) {
  return request<ApiInjury[]>("/injuries", { fixture: fixtureId });
},

async getTeamStatistics(teamId: number, leagueId: number, season: number, date?: string) {
  // Note: this endpoint returns a single object, not an array.
  // Pass `date` (ISO date string, e.g. fixture.date) to get stats computed up to that point in the
  // season. Without it, the API returns stats including matches played after the fixture date,
  // which would be data leakage for in-season predictions.
  return request<ApiTeamStatisticsResponse>("/teams/statistics", {
    team: teamId, league: leagueId, season, ...(date ? { date } : {}),
  });
},

async getPlayers(params: PlayerParams) {
  return request<ApiPlayerResponse[]>("/players", params as Record<string, string | number>);
},

// Pagination helper — fetches all pages and returns the full raw list.
// Always use this from the pipeline rather than calling getPlayers in a loop externally.
async getAllPlayers(teamId: number, season: number): Promise<ApiPlayerResponse[]> {
  const all: ApiPlayerResponse[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const resp = await request<ApiPlayerResponse[]>("/players", { team: teamId, season, page });
    totalPages = resp.paging.total;
    all.push(...resp.response);
    page++;
  } while (page <= totalPages);
  return all;
},
```

### `src/infrastructure/sports-data/mappers.ts`

Add mapper functions for the new response types.

```typescript
export function mapApiInjuries(injuries: ApiInjury[]): Injury[] {
  return injuries.map((inj) => ({
    playerId: inj.player.id,
    playerName: inj.player.name,
    type: inj.player.type, // typed as string — injurySchema accepts any string value
    reason: inj.player.reason,
    teamId: inj.team.id,
  }));
}

// Helper: extract the 8 known minute-interval keys from the open Record returned by the API.
// Defaults to { total: null, percentage: null } for any missing interval.
function mapMinuteStats(
  raw: Record<string, { total: number | null; percentage: string | null }>,
): z.infer<typeof goalsByMinuteSchema> {
  const intervals = ["0-15", "16-30", "31-45", "46-60", "61-75", "76-90", "91-105", "106-120"] as const;
  return Object.fromEntries(
    intervals.map((k) => [k, raw[k] ?? { total: null, percentage: null }]),
  ) as z.infer<typeof goalsByMinuteSchema>;
}

// Helper: extract the 5 known under/over line keys from the open Record returned by the API.
// Defaults to { over: 0, under: 0 } for any missing line.
function mapUnderOver(
  raw: Record<string, { over: number; under: number }>,
): z.infer<typeof underOverSchema> {
  const lines = ["0.5", "1.5", "2.5", "3.5", "4.5"] as const;
  return Object.fromEntries(
    lines.map((k) => [k, raw[k] ?? { over: 0, under: 0 }]),
  ) as z.infer<typeof underOverSchema>;
}

export function mapApiTeamStatistics(raw: ApiTeamStatisticsResponse): TeamSeasonStats {
  return {
    form: raw.form ?? null,
    fixtures: { played: raw.fixtures.played },
    cleanSheets: raw.clean_sheet,
    failedToScore: raw.failed_to_score,
    biggestStreak: raw.biggest.streak,
    penaltyRecord: {
      scored: raw.penalty.scored.total,
      missed: raw.penalty.missed.total,
      total: raw.penalty.total,
    },
    preferredFormations: raw.lineups.map((l) => ({ formation: l.formation, played: l.played })),
    goalsForByMinute: mapMinuteStats(raw.goals.for.minute),
    goalsAgainstByMinute: mapMinuteStats(raw.goals.against.minute),
    goalsForUnderOver: mapUnderOver(raw.goals.for.under_over),
    goalsAgainstUnderOver: mapUnderOver(raw.goals.against.under_over),
  };
}

export function mapApiPlayerToPlayerStats(raw: ApiPlayerResponse, leagueId: number): PlayerSeasonStats | null {
  // Find stats for the relevant league
  const stat = raw.statistics.find((s) => s.league.id === leagueId);
  if (!stat) return null;

  return {
    playerId: raw.player.id,
    name: raw.player.name,
    position: stat.games.position,
    rating: stat.games.rating ? parseFloat(stat.games.rating) : null,
    appearances: stat.games.appearences ?? 0,
    minutes: stat.games.minutes ?? 0,
    goals: stat.goals.total ?? 0,
    assists: stat.goals.assists ?? 0,
    shotsTotal: stat.shots.total,
    shotsOnTarget: stat.shots.on,
    passesKey: stat.passes.key,
    passAccuracy: stat.passes.accuracy,
    dribblesSuccess: stat.dribbles.success,
    dribblesAttempts: stat.dribbles.attempts,
    yellowCards: stat.cards.yellow,
    redCards: stat.cards.red,
    injured: raw.player.injured,
  };
}
```

### `src/infrastructure/database/schema.ts`

Add two cache tables for team and player statistics.

```typescript
export const teamStatsCache = sqliteTable("team_stats_cache", {
  id: text("id").primaryKey(), // "{teamId}-{leagueId}-{season}"
  teamId: integer("team_id").notNull(),
  leagueId: integer("league_id").notNull(),
  season: integer("season").notNull(),
  data: text("data", { mode: "json" }).$type<TeamSeasonStats>().notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
});

export const playerStatsCache = sqliteTable("player_stats_cache", {
  id: text("id").primaryKey(), // "{teamId}-{leagueId}-{season}"
  teamId: integer("team_id").notNull(),
  leagueId: integer("league_id").notNull(),
  season: integer("season").notNull(),
  data: text("data", { mode: "json" }).$type<PlayerSeasonStats[]>().notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
});
```

### `src/infrastructure/database/repositories/stats-cache.ts`

New repository for the cache tables. The composite cache key is constructed as `"${teamId}-${leagueId}-${season}"` — build this string consistently in both `get` and `set` methods.

```typescript
export function statsCacheRepo(db: Database) {
  return {
    async getTeamStats(teamId: number, leagueId: number, season: number, maxAgeMs: number):
      Promise<TeamSeasonStats | null> { /* check fetchedAt freshness */ },
    async setTeamStats(teamId: number, leagueId: number, season: number, data: TeamSeasonStats):
      Promise<void> { /* upsert */ },

    async getPlayerStats(teamId: number, leagueId: number, season: number, maxAgeMs: number):
      Promise<PlayerSeasonStats[] | null> { /* check fetchedAt freshness */ },
    async setPlayerStats(teamId: number, leagueId: number, season: number, data: PlayerSeasonStats[]):
      Promise<void> { /* upsert */ },
  };
}
```

### `src/orchestrator/prediction-pipeline.ts`

After the existing standings + h2h fetch (Step 2d), add calls for injuries, team stats, and player stats.

```typescript
// Step 2d-2: Fetch injuries (always fresh)
let injuries: Injury[] = [];
try {
  const injResp = await footballClient.getInjuries(fixture.id);
  injuries = mapApiInjuries(injResp.response);
} catch (err) {
  logger.warn("Prediction: injuries fetch failed, continuing without", { ... });
}

// Step 2d-3: Fetch team season statistics (with cache)
let homeTeamSeasonStats: TeamSeasonStats | undefined;
let awayTeamSeasonStats: TeamSeasonStats | undefined;
const STATS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

try {
  homeTeamSeasonStats = await statsCache.getTeamStats(
    fixture.homeTeam.id, fixture.league.id, fixture.league.season, STATS_CACHE_TTL,
  );
  if (!homeTeamSeasonStats) {
    const resp = await footballClient.getTeamStatistics(
      fixture.homeTeam.id, fixture.league.id, fixture.league.season, fixture.date,
      // fixture.date prevents stats from including matches played after this fixture (data leakage)
    );
    homeTeamSeasonStats = mapApiTeamStatistics(resp.response);
    await statsCache.setTeamStats(fixture.homeTeam.id, fixture.league.id, fixture.league.season, homeTeamSeasonStats);
  }
} catch (err) { logger.warn("Prediction: home team stats fetch failed", { ... }); }

// Same for away team...

// Step 2d-4: Fetch player stats (with cache, paginated)
// getAllPlayers handles pagination internally — do not call getPlayers in a loop here.
let homeTeamPlayers: PlayerSeasonStats[] | undefined;
let awayTeamPlayers: PlayerSeasonStats[] | undefined;

try {
  homeTeamPlayers = await statsCache.getPlayerStats(
    fixture.homeTeam.id, fixture.league.id, fixture.league.season, STATS_CACHE_TTL,
  );
  if (!homeTeamPlayers) {
    const raw = await footballClient.getAllPlayers(fixture.homeTeam.id, fixture.league.season);
    homeTeamPlayers = raw
      .map((p) => mapApiPlayerToPlayerStats(p, fixture.league.id))
      .filter((p): p is PlayerSeasonStats => p !== null && p.appearances > 0);
    await statsCache.setPlayerStats(fixture.homeTeam.id, fixture.league.id, fixture.league.season, homeTeamPlayers);
  }
  // Summarise: top 8 by rating + any fixture-specific injured players (see note below)
  homeTeamPlayers = summarisePlayerStats(homeTeamPlayers, injuries);
} catch (err) { logger.warn("Prediction: home player stats fetch failed", { ... }); }

// Same for away team...

// Step 2e: Build statistics (enriched)
const statistics: Statistics = {
  fixtureId: fixture.id,
  league: fixture.league,
  homeTeam: homeStats,
  awayTeam: awayStats,
  h2h,
  markets: marketContexts,
  injuries,                  // NEW
  homeTeamSeasonStats,       // NEW
  awayTeamSeasonStats,       // NEW
  homeTeamPlayers,           // NEW
  awayTeamPlayers,           // NEW
};
```

`summarisePlayerStats` helper (pagination is now handled by `footballClient.getAllPlayers`):

```typescript
function summarisePlayerStats(
  allPlayers: PlayerSeasonStats[], injuries: Injury[],
): PlayerSeasonStats[] {
  // Sort by rating descending, take top 8
  const sorted = [...allPlayers].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const top = sorted.slice(0, 8);

  // Add any fixture-specific injured players not already in the top 8.
  // NOTE: `injuries` comes from /injuries?fixture=X — these are players confirmed
  // missing/questionable for THIS fixture specifically. This is different from
  // PlayerSeasonStats.injured (a general season-level flag from /players) which
  // should NOT be used here. Always use the fixture-specific Injury[] list.
  const injuredIds = new Set(injuries.map((i) => i.playerId));
  for (const player of allPlayers) {
    if (injuredIds.has(player.playerId) && !top.find((p) => p.playerId === player.playerId)) {
      top.push(player);
    }
  }
  return top;
}
```

### `src/competitors/weight-tuned/features.ts`

Add new feature extractors that leverage the enriched data.

```typescript
// Injury impact: more confirmed-missing players for away team = advantage for home.
// Only counts "Missing Fixture" (confirmed absent), not "Questionable" (uncertain).
// Divisor of 6: max meaningful gap assumed to be ~6 players; clamped so larger gaps don't overflow.
injuryImpact: (stats) => {
  if (!stats.injuries?.length) return 0.5;
  const homeMissing = stats.injuries.filter(
    (i) => i.teamId === stats.homeTeam.teamId && i.type === "Missing Fixture",
  ).length;
  const awayMissing = stats.injuries.filter(
    (i) => i.teamId === stats.awayTeam.teamId && i.type === "Missing Fixture",
  ).length;
  return clamp((awayMissing - homeMissing) / 6 + 0.5, 0, 1);
},

// Clean sheet strength: home team keeps clean sheets vs away doesn't.
// Uses fixtures.played.total from the season stats as the denominator — same source as
// cleanSheets.total, so the rates are consistent. Do NOT use stats.homeTeam.played here.
cleanSheetDiff: (stats) => {
  if (!stats.homeTeamSeasonStats || !stats.awayTeamSeasonStats) return 0.5;
  const homePlayed = stats.homeTeamSeasonStats.fixtures.played.total || 1;
  const awayPlayed = stats.awayTeamSeasonStats.fixtures.played.total || 1;
  const homeRate = stats.homeTeamSeasonStats.cleanSheets.total / homePlayed;
  const awayRate = stats.awayTeamSeasonStats.cleanSheets.total / awayPlayed;
  return clamp((homeRate - awayRate) / 0.6 + 0.5, 0, 1);
},

// Scoring consistency: home team rarely fails to score vs away often does.
// Divisor of 0.6: assumes a max meaningful rate difference of 60 percentage points.
// Uses fixtures.played.total from season stats as denominator (same source as failedToScore).
scoringConsistency: (stats) => {
  if (!stats.homeTeamSeasonStats || !stats.awayTeamSeasonStats) return 0.5;
  const homePlayed = stats.homeTeamSeasonStats.fixtures.played.total || 1;
  const awayPlayed = stats.awayTeamSeasonStats.fixtures.played.total || 1;
  const homeFail = stats.homeTeamSeasonStats.failedToScore.total / homePlayed;
  const awayFail = stats.awayTeamSeasonStats.failedToScore.total / awayPlayed;
  return clamp((awayFail - homeFail) / 0.6 + 0.5, 0, 1);
},
```

### `src/competitors/weight-tuned/types.ts`

Add the new signal names to `DEFAULT_WEIGHTS` (defaulted to 0.0 so existing competitors unaffected).

```typescript
signals: {
  // existing
  homeWinRate: 0.4,
  formDiff: 0.3,
  h2h: 0.3,
  awayLossRate: 0.0,
  goalDiff: 0.0,
  pointsPerGame: 0.0,
  defensiveStrength: 0.0,
  // NEW
  injuryImpact: 0.0,
  cleanSheetDiff: 0.0,
  scoringConsistency: 0.0,
},
```

---

## Data & Migration

**New migration:** Add `team_stats_cache` and `player_stats_cache` tables.

- Both are cache tables with a composite key (`teamId-leagueId-season`), JSON `data` column, and `fetchedAt` timestamp.
- No foreign keys needed — these are ephemeral caches.
- If the cache is stale (older than 24 hours), the pipeline refetches and overwrites.

Generate migration with: `bunx drizzle-kit generate`

---

## Test Plan

### `tests/unit/infrastructure/sports-data/client.test.ts`
- Test `getInjuries()` builds correct URL with fixture param
- Test `getTeamStatistics()` builds correct URL with team, league, season params
- Test `getTeamStatistics()` includes `date` param in URL when provided
- Test `getPlayers()` builds correct URL with team, season, page params
- Test `getAllPlayers()` fetches multiple pages and returns combined results (mock `paging.total > 1`)

### `tests/unit/infrastructure/sports-data/mappers.test.ts`
- Test `mapApiInjuries()` maps injury list correctly — `type` is passed through as-is (no enum restriction)
- Test `mapApiInjuries()` returns empty array for empty input
- Test `mapApiTeamStatistics()` maps clean sheets, failed to score, biggest streak
- Test `mapApiTeamStatistics()` maps `fixtures.played` correctly
- Test `mapApiTeamStatistics()` maps goals by minute — including default `{ total: null, percentage: null }` for a missing interval key
- Test `mapApiTeamStatistics()` maps under/over data — including default `{ over: 0, under: 0 }` for a missing line key
- Test `mapApiTeamStatistics()` maps preferred formations
- Test `mapApiTeamStatistics()` maps penalty record
- Test `mapApiPlayerToPlayerStats()` maps player stats for correct league
- Test `mapApiPlayerToPlayerStats()` returns null when league not found in player stats
- Test `mapApiPlayerToPlayerStats()` handles null rating and appearances

### `tests/unit/infrastructure/database/repositories/stats-cache.test.ts`
- Test `getTeamStats()` returns null when no cache entry
- Test `getTeamStats()` returns null when cache is stale
- Test `getTeamStats()` returns data when cache is fresh
- Test `setTeamStats()` upserts correctly
- Same test cases for `getPlayerStats()` / `setPlayerStats()`

### `tests/unit/competitors/weight-tuned/features.test.ts`
- Test `injuryImpact` returns 0.5 when no injuries
- Test `injuryImpact` returns >0.5 when away team has more missing players
- Test `injuryImpact` returns <0.5 when home team has more missing players
- Test `injuryImpact` ignores "Questionable" players (only counts "Missing Fixture")
- Test `cleanSheetDiff` returns 0.5 when no season stats
- Test `cleanSheetDiff` returns >0.5 when home team keeps more clean sheets
- Test `scoringConsistency` returns >0.5 when away team fails to score more often

### `tests/unit/orchestrator/prediction-pipeline.test.ts`
- Test enriched statistics include `injuries` when API call succeeds
- Test enriched statistics include `homeTeamSeasonStats` / `awayTeamSeasonStats` when cached
- Test enriched statistics include `homeTeamPlayers` / `awayTeamPlayers` with top 8 + injured
- Test pipeline continues gracefully when injuries API fails (field is empty array)
- Test pipeline continues gracefully when team stats API fails (field is undefined)
- Test pipeline continues gracefully when player stats API fails (field is undefined)
- Test player stats pagination fetches multiple pages

---

## Task Breakdown

### Phase 1: Types & contracts
- [x] Add `ApiInjury`, `ApiTeamStatisticsResponse`, `ApiPlayerResponse`, `PlayerParams` types to `src/infrastructure/sports-data/types.ts`
- [x] Add `injurySchema`, `goalsByMinuteSchema`, `underOverSchema`, `teamSeasonStatsSchema`, `playerSeasonStatsSchema` to `src/domain/contracts/statistics.ts`
- [x] Add optional `injuries`, `homeTeamSeasonStats`, `awayTeamSeasonStats`, `homeTeamPlayers`, `awayTeamPlayers` fields to `statisticsSchema`
- [x] Export new types `Injury`, `TeamSeasonStats`, `PlayerSeasonStats` from contracts

### Phase 2: Client methods
- [x] Add `getInjuries(fixtureId)` method to `src/infrastructure/sports-data/client.ts`
- [x] Add `getTeamStatistics(teamId, leagueId, season, date?)` method — include `date` param to prevent data leakage
- [x] Add `getPlayers(params)` method to `src/infrastructure/sports-data/client.ts`
- [x] Add `getAllPlayers(teamId, season)` pagination helper to `FootballClient` — handles all pages internally
- [x] Update `FootballClient` type export
- [x] Write tests for new client methods (including `getAllPlayers` multi-page test)

### Phase 3: Mappers
- [x] Add `mapApiInjuries()` to `src/infrastructure/sports-data/mappers.ts` — no type cast on `type` field, pass through as string
- [x] Add `mapMinuteStats()` private helper — extracts the 8 known interval keys from the open `Record`, defaults missing keys to `{ total: null, percentage: null }`
- [x] Add `mapUnderOver()` private helper — extracts the 5 known line keys (`"0.5"`–`"4.5"`) from the open `Record`, defaults missing keys to `{ over: 0, under: 0 }`
- [x] Add `mapApiTeamStatistics()` using the two helpers above; include `fixtures.played` in the return value
- [x] Add `mapApiPlayerToPlayerStats()` to mappers
- [x] Write tests for all new mappers (including missing-key defaults for `mapMinuteStats` / `mapUnderOver`)

### Phase 4: Database cache
- [x] Add `team_stats_cache` and `player_stats_cache` tables to `src/infrastructure/database/schema.ts`
- [x] Generate and apply migration
- [x] Create `src/infrastructure/database/repositories/stats-cache.ts` — use `Database` type (not `DatabaseClient`); construct composite key as `"${teamId}-${leagueId}-${season}"` consistently in both get and set methods
- [x] Write tests for stats cache repository

### Phase 5: Pipeline integration
- [x] Add injuries fetch to `src/orchestrator/prediction-pipeline.ts` (always fresh)
- [x] Add team statistics fetch with cache to pipeline — pass `fixture.date` to `getTeamStatistics`
- [x] Add player statistics fetch with cache to pipeline — call `footballClient.getAllPlayers`, then map + filter in the pipeline; do NOT implement a pagination loop here
- [x] Add `summarisePlayerStats()` helper to pipeline (top 8 by rating + fixture-specific injured players)
- [x] Include all new fields in the `Statistics` object construction
- [x] Add `statsCacheRepo` to `PredictionPipelineDeps` type in `prediction-pipeline.ts`
- [x] Update the scheduler entry point (where `createPredictionPipeline` is called) to instantiate `statsCacheRepo` and pass it in
- [x] Write pipeline integration tests

### Phase 6: Feature extractors
- [x] Add `injuryImpact` feature extractor to `src/competitors/weight-tuned/features.ts` — uses fixture-specific `Injury[]`, not `player.injured`
- [x] Add `cleanSheetDiff` feature extractor — use `homeTeamSeasonStats.fixtures.played.total` as denominator, not `stats.homeTeam.played`
- [x] Add `scoringConsistency` feature extractor — same denominator rule as `cleanSheetDiff`
- [x] Add new signal names to `DEFAULT_WEIGHTS` in `src/competitors/weight-tuned/types.ts` (defaulted to 0.0)
- [x] Update `WEIGHT_JSON_SCHEMA.schema.properties.signals.description` to list the three new signal names so LLMs generating weights are aware of them
- [x] Write tests for new feature extractors (including the `injuryImpact` test that verifies `"Questionable"` is not counted)

### Phase 7: Verify
- [x] Run `bun test` — all tests pass
- [x] Run `bun run typecheck` — no TypeScript errors
- [x] Run `bun run lint:fix` — no Biome errors
