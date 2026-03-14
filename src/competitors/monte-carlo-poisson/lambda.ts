import type { H2H, Injury, PlayerSeasonStats, Statistics } from "../../domain/contracts/statistics";

export const PL_AVERAGES = {
  homeGoalsPerGame: 1.53,
  awayGoalsPerGame: 1.16,
  totalGoalsPerGame: 2.69,
} as const;

const MIN_LAMBDA = 0.3;
const MAX_LAMBDA = 4.0;
const MIN_GAMES_FOR_RELIABLE_STATS = 5;

export type LambdaEstimate = {
  home: number;
  away: number;
  components: {
    baseHome: number;
    baseAway: number;
    homeAttackStrength: number;
    awayAttackStrength: number;
    homeDefenseWeakness: number;
    awayDefenseWeakness: number;
    formAdjustment: number;
    h2hAdjustment: number;
    injuryAdjustment: number;
  };
};

export function estimateLambdas(statistics: Statistics): LambdaEstimate {
  const { homeTeam, awayTeam, h2h } = statistics;

  const homeGamesPlayed = homeTeam.homeRecord.played;
  const awayGamesPlayed = awayTeam.awayRecord.played;

  const homeAttackStrength =
    homeGamesPlayed >= MIN_GAMES_FOR_RELIABLE_STATS
      ? homeTeam.homeRecord.goalsFor / homeGamesPlayed / PL_AVERAGES.homeGoalsPerGame
      : 1.0;

  const awayAttackStrength =
    awayGamesPlayed >= MIN_GAMES_FOR_RELIABLE_STATS
      ? awayTeam.awayRecord.goalsFor / awayGamesPlayed / PL_AVERAGES.awayGoalsPerGame
      : 1.0;

  const homeDefenseWeakness =
    homeGamesPlayed >= MIN_GAMES_FOR_RELIABLE_STATS
      ? homeTeam.homeRecord.goalsAgainst / homeGamesPlayed / PL_AVERAGES.awayGoalsPerGame
      : 1.0;

  const awayDefenseWeakness =
    awayGamesPlayed >= MIN_GAMES_FOR_RELIABLE_STATS
      ? awayTeam.awayRecord.goalsAgainst / awayGamesPlayed / PL_AVERAGES.homeGoalsPerGame
      : 1.0;

  const homeForm = formModifier(homeTeam.form);
  const awayForm = formModifier(awayTeam.form);
  const formAdj = homeForm / awayForm;

  const h2hAdj = h2hModifier(h2h, homeTeam.teamName);

  const homeInjuryAdj = injuryModifier(
    statistics.homeTeamPlayers,
    statistics.injuries,
    homeTeam.teamId,
  );
  const awayInjuryAdj = injuryModifier(
    statistics.awayTeamPlayers,
    statistics.injuries,
    awayTeam.teamId,
  );

  const rawHome =
    PL_AVERAGES.homeGoalsPerGame *
    homeAttackStrength *
    awayDefenseWeakness *
    formAdj *
    h2hAdj *
    homeInjuryAdj;

  const rawAway =
    PL_AVERAGES.awayGoalsPerGame *
    awayAttackStrength *
    homeDefenseWeakness *
    (1 / formAdj) *
    (1 / h2hAdj) *
    awayInjuryAdj;

  return {
    home: clamp(rawHome, MIN_LAMBDA, MAX_LAMBDA),
    away: clamp(rawAway, MIN_LAMBDA, MAX_LAMBDA),
    components: {
      baseHome: PL_AVERAGES.homeGoalsPerGame,
      baseAway: PL_AVERAGES.awayGoalsPerGame,
      homeAttackStrength,
      awayAttackStrength,
      homeDefenseWeakness,
      awayDefenseWeakness,
      formAdjustment: formAdj,
      h2hAdjustment: h2hAdj,
      injuryAdjustment: homeInjuryAdj,
    },
  };
}

export function formModifier(form: string | null): number {
  if (!form) return 1.0;

  const results = form.toUpperCase().split("");
  if (results.length === 0) return 1.0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < results.length; i++) {
    const recencyWeight = results.length - i;
    let value: number;
    switch (results[i]) {
      case "W":
        value = 1;
        break;
      case "D":
        value = 0.5;
        break;
      default:
        value = 0;
    }
    weightedSum += value * recencyWeight;
    totalWeight += recencyWeight;
  }

  const avgForm = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  return 0.85 + avgForm * 0.3;
}

export function h2hModifier(h2h: H2H, homeTeamName: string): number {
  if (h2h.totalMatches < 3) return 1.0;

  const homeGoals = h2h.recentMatches.reduce((sum, m) => {
    return sum + (m.homeTeam === homeTeamName ? m.homeGoals : m.awayGoals);
  }, 0);
  const awayGoals = h2h.recentMatches.reduce((sum, m) => {
    return sum + (m.homeTeam === homeTeamName ? m.awayGoals : m.homeGoals);
  }, 0);

  if (h2h.recentMatches.length === 0) {
    const homeWinRate = h2h.homeWins / h2h.totalMatches;
    return 0.9 + homeWinRate * 0.2;
  }

  const avgHomeGoals = homeGoals / h2h.recentMatches.length;
  const avgAwayGoals = awayGoals / h2h.recentMatches.length;
  const totalAvg = (avgHomeGoals + avgAwayGoals) / 2;

  if (totalAvg === 0) return 1.0;

  const ratio = avgHomeGoals / (avgHomeGoals + avgAwayGoals);
  return 0.85 + ratio * 0.3;
}

export function injuryModifier(
  players: PlayerSeasonStats[] | undefined,
  injuries: Injury[] | undefined,
  teamId: number,
): number {
  if (!players || !injuries) return 1.0;

  const teamInjuries = injuries.filter((inj) => inj.teamId === teamId);
  if (teamInjuries.length === 0) return 1.0;

  const injuredPlayerIds = new Set(teamInjuries.map((inj) => inj.playerId));

  let impactCount = 0;
  for (const player of players) {
    if (!injuredPlayerIds.has(player.playerId)) continue;

    const isKeyPlayer =
      (player.rating !== null && player.rating > 7.0) ||
      player.goals >= 3 ||
      (player.position === "Attacker" && player.appearances > 10);

    if (isKeyPlayer) {
      impactCount++;
    }
  }

  const adjustment = 1 - impactCount * 0.05;
  return Math.max(0.85, Math.min(1.15, adjustment));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
