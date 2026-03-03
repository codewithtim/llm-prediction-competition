import type {
  H2H,
  Injury,
  PlayerSeasonStats,
  TeamSeasonStats,
  TeamStats,
} from "@domain/contracts/statistics.ts";
import type { Fixture, FixtureStatus } from "@domain/models/fixture.ts";
import type {
  ApiFixture,
  ApiInjury,
  ApiPlayerResponse,
  ApiStandingEntry,
  ApiTeamStatisticsResponse,
} from "./types.ts";

const STATUS_MAP: Record<string, FixtureStatus> = {
  NS: "scheduled",
  TBD: "scheduled",
  "1H": "in_progress",
  HT: "in_progress",
  "2H": "in_progress",
  ET: "in_progress",
  BT: "in_progress",
  P: "in_progress",
  LIVE: "in_progress",
  FT: "finished",
  AET: "finished",
  PEN: "finished",
  AWD: "finished",
  WO: "finished",
  PST: "postponed",
  SUSP: "postponed",
  INT: "postponed",
  CANC: "cancelled",
  ABD: "cancelled",
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

export function mapH2hFixturesToH2H(fixtures: ApiFixture[], homeTeamId: number): H2H {
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;

  for (const f of fixtures) {
    if (f.goals.home === null || f.goals.away === null) continue;
    const isHomeTeamHome = f.teams.home.id === homeTeamId;
    const ourGoals = isHomeTeamHome ? f.goals.home : f.goals.away;
    const theirGoals = isHomeTeamHome ? f.goals.away : f.goals.home;

    if (ourGoals > theirGoals) homeWins++;
    else if (theirGoals > ourGoals) awayWins++;
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

export function mapApiInjuries(injuries: ApiInjury[]): Injury[] {
  return injuries.map((inj) => ({
    playerId: inj.player.id,
    playerName: inj.player.name,
    type: inj.player.type,
    reason: inj.player.reason,
    teamId: inj.team.id,
  }));
}

const MINUTE_INTERVALS = [
  "0-15",
  "16-30",
  "31-45",
  "46-60",
  "61-75",
  "76-90",
  "91-105",
  "106-120",
] as const;

function mapMinuteStats(
  raw: Record<string, { total: number | null; percentage: string | null }>,
): Record<string, { total: number | null; percentage: string | null }> {
  return Object.fromEntries(
    MINUTE_INTERVALS.map((k) => [k, raw[k] ?? { total: null, percentage: null }]),
  );
}

const UNDER_OVER_LINES = ["0.5", "1.5", "2.5", "3.5", "4.5"] as const;

function mapUnderOver(
  raw: Record<string, { over: number; under: number }>,
): Record<string, { over: number; under: number }> {
  return Object.fromEntries(UNDER_OVER_LINES.map((k) => [k, raw[k] ?? { over: 0, under: 0 }]));
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
  } as TeamSeasonStats;
}

export function mapApiPlayerToPlayerStats(
  raw: ApiPlayerResponse,
  leagueId: number,
): PlayerSeasonStats | null {
  const stat = raw.statistics.find((s) => s.league.id === leagueId);
  if (!stat) return null;

  return {
    playerId: raw.player.id,
    name: raw.player.name,
    position: stat.games.position,
    rating: stat.games.rating ? Number.parseFloat(stat.games.rating) : null,
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
