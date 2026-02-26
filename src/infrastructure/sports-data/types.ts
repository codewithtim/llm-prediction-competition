export type ApiResponse<T> = {
  get: string;
  parameters: Record<string, string>;
  errors: Record<string, string> | [];
  results: number;
  paging: { current: number; total: number };
  response: T;
};

export type ApiFixture = {
  fixture: {
    id: number;
    referee: string | null;
    timezone: string;
    date: string;
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

export type ApiStandingsResponse = {
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string;
    season: number;
    standings: ApiStandingEntry[][];
  };
};

export type ApiStandingEntry = {
  rank: number;
  team: { id: number; name: string; logo: string };
  points: number;
  goalsDiff: number;
  form: string | null;
  all: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
  home: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
  away: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
};

export type FixtureParams = {
  league?: number;
  season?: number;
  from?: string;
  to?: string;
  date?: string;
  status?: string;
  id?: number;
};
