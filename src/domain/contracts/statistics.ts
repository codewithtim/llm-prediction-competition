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

export const injurySchema = z.object({
  playerId: z.number(),
  playerName: z.string(),
  type: z.string(),
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
  form: z.string().nullable(),
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
  markets: z.array(marketContextSchema).min(1),
  injuries: z.array(injurySchema).optional(),
  homeTeamSeasonStats: teamSeasonStatsSchema.optional(),
  awayTeamSeasonStats: teamSeasonStatsSchema.optional(),
  homeTeamPlayers: z.array(playerSeasonStatsSchema).optional(),
  awayTeamPlayers: z.array(playerSeasonStatsSchema).optional(),
  homeTeamLeagueTier: z.number().optional(),
  awayTeamLeagueTier: z.number().optional(),
});

export type TeamStats = z.infer<typeof teamStatsSchema>;
export type H2H = z.infer<typeof h2hSchema>;
export type MarketContext = z.infer<typeof marketContextSchema>;
export type Injury = z.infer<typeof injurySchema>;
export type TeamSeasonStats = z.infer<typeof teamSeasonStatsSchema>;
export type PlayerSeasonStats = z.infer<typeof playerSeasonStatsSchema>;
export type Statistics = z.infer<typeof statisticsSchema>;
