import { z } from "zod";

const recordSchema = z.object({
  played: z.number(),
  wins: z.number(),
  draws: z.number(),
  losses: z.number(),
  goalsFor: z.number(),
  goalsAgainst: z.number(),
});

export const teamStatsSchema = z.object({
  teamId: z.number(),
  teamName: z.string(),
  played: z.number(),
  wins: z.number(),
  draws: z.number(),
  losses: z.number(),
  goalsFor: z.number(),
  goalsAgainst: z.number(),
  goalDifference: z.number(),
  points: z.number(),
  form: z.string().nullable(),
  homeRecord: recordSchema,
  awayRecord: recordSchema,
});

export const h2hSchema = z.object({
  totalMatches: z.number(),
  homeWins: z.number(),
  awayWins: z.number(),
  draws: z.number(),
  recentMatches: z.array(
    z.object({
      date: z.string(),
      homeTeam: z.string(),
      awayTeam: z.string(),
      homeGoals: z.number(),
      awayGoals: z.number(),
    }),
  ),
});

export const marketContextSchema = z.object({
  marketId: z.string(),
  question: z.string(),
  currentYesPrice: z.number(),
  currentNoPrice: z.number(),
  liquidity: z.number(),
  volume: z.number(),
  sportsMarketType: z.string().nullable(),
  line: z.number().nullable(),
});

export const statisticsSchema = z.object({
  fixtureId: z.number(),
  league: z.object({
    id: z.number(),
    name: z.string(),
    country: z.string(),
    season: z.number(),
  }),
  homeTeam: teamStatsSchema,
  awayTeam: teamStatsSchema,
  h2h: h2hSchema,
  market: marketContextSchema,
});

export type TeamStats = z.infer<typeof teamStatsSchema>;
export type H2H = z.infer<typeof h2hSchema>;
export type MarketContext = z.infer<typeof marketContextSchema>;
export type Statistics = z.infer<typeof statisticsSchema>;
