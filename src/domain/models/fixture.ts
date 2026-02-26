export type Fixture = {
  id: number;
  league: League;
  homeTeam: Team;
  awayTeam: Team;
  date: string;
  venue: string | null;
  status: FixtureStatus;
};

export type League = {
  id: number;
  name: string;
  country: string;
  season: number;
};

export type Team = {
  id: number;
  name: string;
  logo: string | null;
};

export type FixtureStatus = "scheduled" | "in_progress" | "finished" | "postponed" | "cancelled";
