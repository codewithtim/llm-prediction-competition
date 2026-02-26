import type { H2H, TeamStats } from "@domain/contracts/statistics.ts";
import type { Fixture, FixtureStatus } from "@domain/models/fixture.ts";
import type { ApiFixture, ApiStandingEntry } from "./types.ts";

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
