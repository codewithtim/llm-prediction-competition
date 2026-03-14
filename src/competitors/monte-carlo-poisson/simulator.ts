import { dixonColesAdjustment, poissonPmf } from "./poisson";

export type SimulationConfig = {
  iterations: number;
  maxGoals: number;
  rho: number;
  seed?: number;
};

export type SimulationResult = {
  homeWinPct: number;
  drawPct: number;
  awayWinPct: number;
  avgHomeGoals: number;
  avgAwayGoals: number;
  scoreDistribution: Map<string, number>;
  confidence: number;
};

export const DEFAULT_SIM_CONFIG: SimulationConfig = {
  iterations: 10_000,
  maxGoals: 8,
  rho: -0.04,
};

function createRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;

  let s = seed | 0;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function samplePoisson(lambda: number, rng: () => number = Math.random): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

export function simulateMatch(
  lambdaHome: number,
  lambdaAway: number,
  config?: Partial<SimulationConfig>,
): SimulationResult {
  const { iterations, maxGoals, rho, seed } = { ...DEFAULT_SIM_CONFIG, ...config };
  const rng = createRng(seed);

  // Precompute Poisson PMFs for accept/reject with Dixon-Coles
  const homePmf: number[] = [];
  const awayPmf: number[] = [];
  for (let k = 0; k <= maxGoals; k++) {
    homePmf.push(poissonPmf(lambdaHome, k));
    awayPmf.push(poissonPmf(lambdaAway, k));
  }

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let totalHomeGoals = 0;
  let totalAwayGoals = 0;
  const scoreCounts = new Map<string, number>();

  for (let i = 0; i < iterations; i++) {
    const hg = samplePoisson(lambdaHome, rng);
    const ag = samplePoisson(lambdaAway, rng);

    const clampedH = Math.min(hg, maxGoals);
    const clampedA = Math.min(ag, maxGoals);

    // Dixon-Coles accept/reject for correlation
    if (rho !== 0 && clampedH <= 1 && clampedA <= 1) {
      const adj = dixonColesAdjustment(clampedH, clampedA, lambdaHome, lambdaAway, rho);
      if (rng() > adj) {
        i--;
        continue;
      }
    }

    totalHomeGoals += hg;
    totalAwayGoals += ag;

    if (hg > ag) homeWins++;
    else if (hg === ag) draws++;
    else awayWins++;

    const key = `${hg}-${ag}`;
    scoreCounts.set(key, (scoreCounts.get(key) ?? 0) + 1);
  }

  const scoreDistribution = new Map<string, number>();
  for (const [key, count] of scoreCounts) {
    scoreDistribution.set(key, count / iterations);
  }

  const homeWinPct = homeWins / iterations;
  const drawPct = draws / iterations;
  const awayWinPct = awayWins / iterations;

  // Confidence: how far the dominant outcome is from uniform (1/3)
  const maxProb = Math.max(homeWinPct, drawPct, awayWinPct);
  const confidence = Math.min((maxProb - 1 / 3) / (2 / 3), 1);

  return {
    homeWinPct,
    drawPct,
    awayWinPct,
    avgHomeGoals: totalHomeGoals / iterations,
    avgAwayGoals: totalAwayGoals / iterations,
    scoreDistribution,
    confidence: Math.max(0, confidence),
  };
}
