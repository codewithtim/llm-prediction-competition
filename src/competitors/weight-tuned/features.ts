import type {
  H2H,
  PlayerSeasonStats,
  Statistics,
  TeamSeasonStats,
  TeamStats,
} from "../../domain/contracts/statistics";

export function parseForm(form: string | null): number {
  if (!form) return 0.5;
  let score = 0;
  let count = 0;
  for (const ch of form) {
    if (ch === "W") {
      score += 1;
      count++;
    } else if (ch === "D") {
      score += 0.5;
      count++;
    } else if (ch === "L") {
      count++;
    }
  }
  return count === 0 ? 0.5 : score / count;
}

export function computeHomeWinRate(home: TeamStats): number {
  if (home.homeRecord.played === 0) return 0.5;
  return home.homeRecord.wins / home.homeRecord.played;
}

export function computeH2hAdvantage(h2h: H2H): number {
  if (h2h.totalMatches === 0) return 0.5;
  return h2h.homeWins / h2h.totalMatches;
}

export type FeatureExtractor = (statistics: Statistics) => number;

export type FeatureEntry = {
  extract: FeatureExtractor;
  description: string;
  sources: string[];
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lateGoalProportion(byMinute: TeamSeasonStats["goalsForByMinute"]): number {
  let late = 0;
  let total = 0;
  for (const [bucket, data] of Object.entries(byMinute)) {
    const val = data.total ?? 0;
    total += val;
    if (bucket === "76-90" || bucket === "91-105" || bucket === "106-120") {
      late += val;
    }
  }
  return total === 0 ? 0 : late / total;
}

function underOverRate(bucket: { over: number; under: number }): number {
  const total = bucket.over + bucket.under;
  return total > 0 ? bucket.over / total : 0.5;
}

function averagePlayerRating(players: PlayerSeasonStats[]): number {
  if (players.length === 0) return 6.5;
  let sum = 0;
  for (const p of players) {
    sum += p.rating ?? 6.5;
  }
  return sum / players.length;
}

export const FEATURE_REGISTRY: Record<string, FeatureEntry> = {
  homeWinRate: {
    extract: (stats) => computeHomeWinRate(stats.homeTeam),
    description: "Home team's win rate at home. Higher = stronger home team.",
    sources: ["homeTeam.homeRecord"],
  },

  awayLossRate: {
    extract: (stats) => {
      const away = stats.awayTeam.awayRecord;
      if (away.played === 0) return 0.5;
      return away.losses / away.played;
    },
    description:
      "Away team's loss rate when playing away. Higher = weaker away team (good for home).",
    sources: ["awayTeam.awayRecord"],
  },

  formDiff: {
    extract: (stats) => {
      const homeScore = parseForm(stats.homeTeam.form);
      const awayScore = parseForm(stats.awayTeam.form);
      const diff = homeScore - awayScore;
      return (diff + 1) / 2;
    },
    description: "Recent form difference (home form vs away form). Higher = home in better form.",
    sources: ["homeTeam.form", "awayTeam.form"],
  },

  h2h: {
    extract: (stats) => computeH2hAdvantage(stats.h2h),
    description: "Head-to-head advantage for home team. Higher = home historically dominant.",
    sources: ["h2h.totalMatches", "h2h.homeWins", "h2h.awayWins", "h2h.draws"],
  },

  goalDiff: {
    extract: (stats) => {
      const home = stats.homeTeam;
      const away = stats.awayTeam;
      const homeGDPerGame = home.played > 0 ? home.goalDifference / home.played : 0;
      const awayGDPerGame = away.played > 0 ? away.goalDifference / away.played : 0;
      return clamp((homeGDPerGame - awayGDPerGame) / 4 + 0.5, 0, 1);
    },
    description: "Goal difference per game comparison. Higher = home scores/concedes better.",
    sources: [
      "homeTeam.goalDifference",
      "homeTeam.played",
      "awayTeam.goalDifference",
      "awayTeam.played",
    ],
  },

  pointsPerGame: {
    extract: (stats) => {
      const homePPG = stats.homeTeam.played > 0 ? stats.homeTeam.points / stats.homeTeam.played : 0;
      const awayPPG = stats.awayTeam.played > 0 ? stats.awayTeam.points / stats.awayTeam.played : 0;
      return clamp((homePPG - awayPPG) / 3 + 0.5, 0, 1);
    },
    description: "Points per game comparison. Higher = home accumulates more points.",
    sources: ["homeTeam.points", "awayTeam.points"],
  },

  defensiveStrength: {
    extract: (stats) => {
      const homeGA =
        stats.homeTeam.played > 0 ? stats.homeTeam.goalsAgainst / stats.homeTeam.played : 0;
      const awayGA =
        stats.awayTeam.played > 0 ? stats.awayTeam.goalsAgainst / stats.awayTeam.played : 0;
      return clamp((awayGA - homeGA) / 2 + 0.5, 0, 1);
    },
    description:
      "Defensive comparison (away concedes more vs home concedes less). Higher = home defends better.",
    sources: ["homeTeam.goalsAgainst", "awayTeam.goalsAgainst"],
  },

  injuryImpact: {
    extract: (stats) => {
      if (!stats.injuries?.length) return 0.5;
      let homeMissing = 0;
      let awayMissing = 0;
      for (const i of stats.injuries) {
        if (i.type !== "Missing Fixture") continue;
        if (i.teamId === stats.homeTeam.teamId) homeMissing++;
        else if (i.teamId === stats.awayTeam.teamId) awayMissing++;
      }
      return clamp((awayMissing - homeMissing) / 6 + 0.5, 0, 1);
    },
    description:
      "Missing player comparison. Higher = away team has more players missing (good for home). Returns 0.5 when no injury data available.",
    sources: ["injuries"],
  },

  cleanSheetDiff: {
    extract: (stats) => {
      if (!stats.homeTeamSeasonStats || !stats.awayTeamSeasonStats) return 0.5;
      const homePlayed = stats.homeTeamSeasonStats.fixtures.played.total || 1;
      const awayPlayed = stats.awayTeamSeasonStats.fixtures.played.total || 1;
      const homeRate = stats.homeTeamSeasonStats.cleanSheets.total / homePlayed;
      const awayRate = stats.awayTeamSeasonStats.cleanSheets.total / awayPlayed;
      return clamp((homeRate - awayRate) / 0.6 + 0.5, 0, 1);
    },
    description:
      "Clean sheet rate comparison. Higher = home team keeps more clean sheets relative to away. Returns 0.5 when no season stats available.",
    sources: ["homeTeamSeasonStats.cleanSheets", "awayTeamSeasonStats.cleanSheets"],
  },

  scoringConsistency: {
    extract: (stats) => {
      if (!stats.homeTeamSeasonStats || !stats.awayTeamSeasonStats) return 0.5;
      const homePlayed = stats.homeTeamSeasonStats.fixtures.played.total || 1;
      const awayPlayed = stats.awayTeamSeasonStats.fixtures.played.total || 1;
      const homeFail = stats.homeTeamSeasonStats.failedToScore.total / homePlayed;
      const awayFail = stats.awayTeamSeasonStats.failedToScore.total / awayPlayed;
      return clamp((awayFail - homeFail) / 0.6 + 0.5, 0, 1);
    },
    description:
      "Failed-to-score rate comparison. Higher = away team fails to score more often (good for home). Returns 0.5 when no season stats available.",
    sources: ["homeTeamSeasonStats.failedToScore", "awayTeamSeasonStats.failedToScore"],
  },

  // ── New extractors from TeamSeasonStats ──────────────────────────────

  winStreakMomentum: {
    extract: (stats) => {
      if (!stats.homeTeamSeasonStats || !stats.awayTeamSeasonStats) return 0.5;
      const homeWins = stats.homeTeamSeasonStats.biggestStreak.wins;
      const awayWins = stats.awayTeamSeasonStats.biggestStreak.wins;
      return clamp((homeWins - awayWins) / 8 + 0.5, 0, 1);
    },
    description:
      "Win streak momentum comparison. Higher = home team has had longer winning streaks.",
    sources: ["homeTeamSeasonStats.biggestStreak", "awayTeamSeasonStats.biggestStreak"],
  },

  penaltyReliability: {
    extract: (stats) => {
      if (!stats.homeTeamSeasonStats || !stats.awayTeamSeasonStats) return 0.5;
      const homePen = stats.homeTeamSeasonStats.penaltyRecord;
      const awayPen = stats.awayTeamSeasonStats.penaltyRecord;
      const homeRate = homePen.total > 0 ? homePen.scored / homePen.total : 0.5;
      const awayRate = awayPen.total > 0 ? awayPen.scored / awayPen.total : 0.5;
      return clamp(homeRate - awayRate + 0.5, 0, 1);
    },
    description:
      "Penalty conversion rate comparison. Higher = home converts penalties more reliably.",
    sources: ["homeTeamSeasonStats.penaltyRecord", "awayTeamSeasonStats.penaltyRecord"],
  },

  lateGoalThreat: {
    extract: (stats) => {
      if (!stats.homeTeamSeasonStats || !stats.awayTeamSeasonStats) return 0.5;
      const homeLate = lateGoalProportion(stats.homeTeamSeasonStats.goalsForByMinute);
      const awayLate = lateGoalProportion(stats.awayTeamSeasonStats.goalsForByMinute);
      return clamp((homeLate - awayLate) / 0.5 + 0.5, 0, 1);
    },
    description:
      "Late-game (76-105 min) scoring proportion comparison. Higher = home scores more late goals.",
    sources: ["homeTeamSeasonStats.goalsForByMinute", "awayTeamSeasonStats.goalsForByMinute"],
  },

  lateGoalVulnerability: {
    extract: (stats) => {
      if (!stats.homeTeamSeasonStats || !stats.awayTeamSeasonStats) return 0.5;
      const homeLate = lateGoalProportion(stats.homeTeamSeasonStats.goalsAgainstByMinute);
      const awayLate = lateGoalProportion(stats.awayTeamSeasonStats.goalsAgainstByMinute);
      // Away conceding more late = good for home
      return clamp((awayLate - homeLate) / 0.5 + 0.5, 0, 1);
    },
    description:
      "Late-game conceding proportion comparison. Higher = away team concedes more late goals (good for home).",
    sources: [
      "homeTeamSeasonStats.goalsAgainstByMinute",
      "awayTeamSeasonStats.goalsAgainstByMinute",
    ],
  },

  overTwoFiveGoals: {
    extract: (stats) => {
      if (!stats.homeTeamSeasonStats || !stats.awayTeamSeasonStats) return 0.5;
      const homeRate = underOverRate(stats.homeTeamSeasonStats.goalsForUnderOver["2.5"]);
      const awayRate = underOverRate(stats.awayTeamSeasonStats.goalsForUnderOver["2.5"]);
      return clamp(homeRate - awayRate + 0.5, 0, 1);
    },
    description:
      "Over-2.5 goals tendency comparison. Higher = home team's matches more likely to go over 2.5 goals.",
    sources: ["homeTeamSeasonStats.goalsForUnderOver", "awayTeamSeasonStats.goalsForUnderOver"],
  },

  defensiveOverTwoFive: {
    extract: (stats) => {
      if (!stats.homeTeamSeasonStats || !stats.awayTeamSeasonStats) return 0.5;
      const homeRate = underOverRate(stats.homeTeamSeasonStats.goalsAgainstUnderOver["2.5"]);
      const awayRate = underOverRate(stats.awayTeamSeasonStats.goalsAgainstUnderOver["2.5"]);
      // Away conceding more over-2.5 = good for home
      return clamp(awayRate - homeRate + 0.5, 0, 1);
    },
    description:
      "Over-2.5 goals conceded comparison. Higher = away team concedes over 2.5 more often (good for home).",
    sources: [
      "homeTeamSeasonStats.goalsAgainstUnderOver",
      "awayTeamSeasonStats.goalsAgainstUnderOver",
    ],
  },

  // ── New extractors from PlayerSeasonStats ────────────────────────────

  squadRating: {
    extract: (stats) => {
      if (!stats.homeTeamPlayers?.length || !stats.awayTeamPlayers?.length) return 0.5;
      const homeAvg = averagePlayerRating(stats.homeTeamPlayers);
      const awayAvg = averagePlayerRating(stats.awayTeamPlayers);
      // Typical ratings range 6.0–7.5, so a 1.0 diff is huge
      return clamp((homeAvg - awayAvg) / 2 + 0.5, 0, 1);
    },
    description: "Average player rating comparison. Higher = home squad rated higher overall.",
    sources: ["homeTeamPlayers.*.rating", "awayTeamPlayers.*.rating"],
  },

  attackingOutput: {
    extract: (stats) => {
      if (!stats.homeTeamPlayers?.length || !stats.awayTeamPlayers?.length) return 0.5;
      const homeOutput =
        stats.homeTeamPlayers.reduce((sum, p) => sum + p.goals + p.assists, 0) /
        stats.homeTeamPlayers.length;
      const awayOutput =
        stats.awayTeamPlayers.reduce((sum, p) => sum + p.goals + p.assists, 0) /
        stats.awayTeamPlayers.length;
      return clamp((homeOutput - awayOutput) / 6 + 0.5, 0, 1);
    },
    description:
      "Per-player attacking output (goals + assists) comparison. Higher = home squad more productive.",
    sources: [
      "homeTeamPlayers.*.goals",
      "homeTeamPlayers.*.assists",
      "awayTeamPlayers.*.goals",
      "awayTeamPlayers.*.assists",
    ],
  },

  injuredKeyPlayers: {
    extract: (stats) => {
      if (!stats.homeTeamPlayers?.length || !stats.awayTeamPlayers?.length) return 0.5;
      let homeImpact = 0;
      for (const p of stats.homeTeamPlayers) {
        if (p.injured) homeImpact += p.rating ?? 6.5;
      }
      let awayImpact = 0;
      for (const p of stats.awayTeamPlayers) {
        if (p.injured) awayImpact += p.rating ?? 6.5;
      }
      // Away having more injured quality = good for home
      return clamp((awayImpact - homeImpact) / 20 + 0.5, 0, 1);
    },
    description:
      "Quality-weighted injured player impact. Higher = away team loses more quality to injuries (good for home).",
    sources: [
      "homeTeamPlayers.*.injured",
      "homeTeamPlayers.*.rating",
      "awayTeamPlayers.*.injured",
      "awayTeamPlayers.*.rating",
    ],
  },

  // ── League tier ────────────────────────────────────────────────────

  leagueTierDiff: {
    extract: (stats) => {
      const homeTier = stats.homeTeamLeagueTier;
      const awayTier = stats.awayTeamLeagueTier;
      if (homeTier == null || awayTier == null) return 0.5;
      // Higher tier number = weaker league, so (awayTier - homeTier) > 0 means home is stronger
      return clamp((awayTier - homeTier) / 4 + 0.5, 0, 1);
    },
    description: "League tier difference. Higher = home team from a stronger league.",
    sources: ["homeTeamLeagueTier", "awayTeamLeagueTier"],
  },

  // ── New extractor from H2H ───────────────────────────────────────────

  h2hRecentForm: {
    extract: (stats) => {
      const matches = stats.h2h.recentMatches;
      if (!matches.length) return 0.5;
      const homeName = stats.homeTeam.teamName;
      const last5 = matches.slice(0, 5);
      let score = 0;
      for (const m of last5) {
        const isHome = m.homeTeam === homeName;
        const homeGoals = isHome ? m.homeGoals : m.awayGoals;
        const awayGoals = isHome ? m.awayGoals : m.homeGoals;
        if (homeGoals > awayGoals) score += 1;
        else if (homeGoals === awayGoals) score += 0.5;
      }
      return score / last5.length;
    },
    description:
      "Last 5 H2H match results for the home team. Higher = home team has won more recent head-to-head meetings.",
    sources: ["h2h.recentMatches"],
  },
};

export const FEATURE_NAMES = Object.keys(FEATURE_REGISTRY);

export function getMissingSignals(signals: Record<string, number>): string[] {
  return FEATURE_NAMES.filter((name) => !(name in signals));
}

export function extractFeatures(statistics: Statistics): Record<string, number> {
  const features: Record<string, number> = {};
  for (const [name, entry] of Object.entries(FEATURE_REGISTRY)) {
    features[name] = entry.extract(statistics);
  }
  return features;
}
