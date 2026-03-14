# Plan: Monte Carlo + Poisson Competitor

**Date:** 2026-03-11
**Status:** Implementation Complete (pending DB insert + wallet setup)

---

## Overview

Add a new competitor type (`monte-carlo-poisson`) that predicts football match outcomes using Poisson distribution modeling for expected goals and Monte Carlo simulation for outcome probabilities. Unlike the existing weight-tuned competitor which uses a weighted signal approach, this competitor models the actual goal-scoring process statistically, producing more calibrated probabilities grounded in scoring rates.

---

## Approach

### How Poisson works for football

Football goals follow a Poisson distribution reasonably well. The model:

1. **Estimate lambda (expected goals)** for each team from attack strength, defensive weakness, home advantage, form, and H2H patterns.
2. **Compute P(team scores k goals)** = (lambda^k * e^-lambda) / k! for k = 0, 1, 2, ...
3. **Build a score matrix** — P(home=i, away=j) for all combinations up to some max (e.g., 8 goals).
4. **Derive outcome probabilities** — sum the matrix for P(home win), P(draw), P(away win).

### Why Monte Carlo on top

Pure Poisson assumes independent scoring between teams, which isn't always true (e.g., a team goes defensive after scoring). Monte Carlo simulation adds:

- Ability to model **correlated goals** (Dixon-Coles adjustment for low-scoring games)
- Natural **confidence intervals** from simulation variance
- Easy extensibility for future features (red cards, substitution effects, etc.)

The simulation runs N=10,000 matches per fixture, sampling from the Poisson distributions with an optional correlation adjustment.

### Lambda estimation

Each team's expected goals (lambda) is derived from:

```
lambda_home = leagueAvgHomeGoals
  * (homeTeam.homeGoalsFor / leagueAvgHomeGoals)     // attack strength at home
  * (awayTeam.awayGoalsConceded / leagueAvgAwayGoals) // opponent defensive weakness
  * formAdjustment                                     // recent form modifier
  * h2hAdjustment                                      // head-to-head modifier
  * injuryAdjustment                                   // key player absence modifier
```

Similarly for `lambda_away` with away stats.

Since we only have Premier League data (single league), we can compute league averages from the available team stats in the Statistics object. We don't have access to every team's stats — only the two playing — so we use league-level constants derived from historical Premier League averages as a baseline, adjusted by the per-team data we do have.

### League average estimation

We don't have full league tables, only the two teams' stats. The approach:

- Use the two teams' combined stats as a local estimate
- Fall back to historical PL averages when data is sparse (e.g., early season with < 5 games played)
- Historical PL constants: ~1.53 home goals/game, ~1.16 away goals/game (well-established)

### Stake sizing

Use **fractional Kelly criterion** for stake sizing:

```
kelly = (edge * confidence) / (1 - marketPrice)
stake = kellyFraction * kelly
```

Clamped to [minBetPct, maxBetPct] as with the weight-tuned competitor.

### Trade-offs

| Chose | Over | Reason |
|-------|------|--------|
| Monte Carlo + Poisson matrix | Pure analytical Poisson | MC gives confidence intervals and extensibility; Poisson matrix is the fast path for the base case |
| Historical PL averages as baseline | Computing from available team data only | More stable early-season; two teams' stats are a poor league-wide sample |
| 10,000 simulations | Higher (100k) or lower (1k) | Balances accuracy (< 1% error) with speed (< 50ms) |
| Dixon-Coles correlation | Independent Poisson | Better calibrated for 0-0, 1-0, 0-1 scorelines which pure Poisson underestimates |
| Fractional Kelly | Fixed staking | Better bankroll management; scales stake with edge size |
| No LLM weight tuning | LLM-tunable config | This competitor is purely statistical; config is fixed. Keeps it simple and deterministic. Can add tuning later. |

**Risks:**
- Poisson assumes goals are independent events within a match — not perfectly true
- Lambda estimation quality depends on available stats; early-season data will be noisy
- The model doesn't account for tactical matchup factors that an LLM might capture

---

## Changes Required

### `src/competitors/monte-carlo-poisson/poisson.ts` (new)

Core Poisson math utilities. Pure functions, no side effects.

```typescript
/** Poisson probability mass function: P(X = k) */
export function poissonPmf(lambda: number, k: number): number;

/** Cumulative distribution: P(X <= k) */
export function poissonCdf(lambda: number, k: number): number;

/** Build score matrix P(home=i, away=j) for i,j in [0, maxGoals] */
export function buildScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  maxGoals?: number, // default 8
): number[][];

/** Extract outcome probabilities from score matrix */
export function outcomeProbabilities(matrix: number[][]): {
  home: number;
  draw: number;
  away: number;
};

/** Dixon-Coles correlation adjustment for low-scoring games */
export function dixonColesAdjustment(
  homeGoals: number,
  awayGoals: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number, // correlation parameter, typically -0.1 to 0.1
): number;
```

### `src/competitors/monte-carlo-poisson/lambda.ts` (new)

Lambda (expected goals) estimation from Statistics input.

```typescript
/** Premier League historical averages */
export const PL_AVERAGES = {
  homeGoalsPerGame: 1.53,
  awayGoalsPerGame: 1.16,
  totalGoalsPerGame: 2.69,
} as const;

export type LambdaEstimate = {
  home: number; // expected home goals
  away: number; // expected away goals
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

/** Estimate expected goals for each team */
export function estimateLambdas(statistics: Statistics): LambdaEstimate;

/** Parse form string ("WWDLW") into a recency-weighted modifier */
export function formModifier(form: string | null): number;

/** Compute H2H scoring adjustment from recent matches */
export function h2hModifier(h2h: H2H, homeTeamName: string): number;

/** Estimate injury impact on attack/defense */
export function injuryModifier(
  players: PlayerSeasonStats[] | undefined,
  injuries: Injury[] | undefined,
  teamId: number,
): number;
```

Key implementation details:

- **Attack strength** = team's goals per game / league average goals per game. If home team scores 2.0 goals/game at home and PL average is 1.53, attack strength = 2.0/1.53 = 1.31.
- **Defense weakness** = team's goals conceded per game / league average. If away team concedes 1.5 away and PL average is 1.53, defense factor = 1.5/1.53 = 0.98.
- **Form modifier** = weighted average of last 5 results (W=1, D=0.5, L=0) with recency weighting (most recent = 2x weight). Returns a multiplier centered on 1.0.
- **H2H modifier** = if sufficient history (3+ matches), adjust lambda by historical scoring rate in this matchup vs the team's average. Returns multiplier centered on 1.0.
- **Injury modifier** = if key players (rating > 7.0, or top 3 scorers) are injured, reduce attack lambda by ~5% per key attacker out, increase opponent's lambda by ~3% per key defender out. Capped at +/- 15%.
- **Minimum lambda** = 0.3 (a team always has some chance of scoring).
- **Maximum lambda** = 4.0 (cap extreme estimates).

### `src/competitors/monte-carlo-poisson/simulator.ts` (new)

Monte Carlo match simulator.

```typescript
export type SimulationConfig = {
  iterations: number;       // default 10_000
  maxGoals: number;         // default 8
  rho: number;              // Dixon-Coles correlation, default -0.04
  seed?: number;            // for reproducible tests
};

export type SimulationResult = {
  homeWinPct: number;
  drawPct: number;
  awayWinPct: number;
  avgHomeGoals: number;
  avgAwayGoals: number;
  scoreDistribution: Map<string, number>; // "2-1" => 0.087
  confidence: number; // 1 - (stddev of outcome / mean), a rough calibration metric
};

export const DEFAULT_SIM_CONFIG: SimulationConfig = {
  iterations: 10_000,
  maxGoals: 8,
  rho: -0.04,
};

/** Run Monte Carlo simulation of a match */
export function simulateMatch(
  lambdaHome: number,
  lambdaAway: number,
  config?: Partial<SimulationConfig>,
): SimulationResult;

/** Sample from Poisson distribution using inverse transform */
export function samplePoisson(lambda: number): number;
```

Implementation notes:
- Uses a simple PRNG (xorshift128) seeded for reproducibility in tests, `Math.random()` in production.
- Each iteration: sample homeGoals ~ Poisson(lambdaHome), awayGoals ~ Poisson(lambdaAway), apply Dixon-Coles accept/reject for correlation.
- Confidence metric: based on the margin between the top outcome probability and 1/3 (uniform). Higher separation = higher confidence.

### `src/competitors/monte-carlo-poisson/engine.ts` (new)

Main engine — implements `PredictionEngine`.

```typescript
import type { PredictionEngine } from "../../engine/types";

export type MonteCarloConfig = {
  simulations: number;           // default 10_000
  rho: number;                   // Dixon-Coles rho, default -0.04
  kellyFraction: number;         // fraction of Kelly to stake, default 0.25
  minEdge: number;               // minimum edge to bet, default 0.03
  maxBetPct: number;             // max stake as fraction of bankroll, default 0.05
  minBetPct: number;             // min stake, default 0.005
};

export const DEFAULT_MC_CONFIG: MonteCarloConfig = {
  simulations: 10_000,
  rho: -0.04,
  kellyFraction: 0.25,
  minEdge: 0.03,
  maxBetPct: 0.05,
  minBetPct: 0.005,
};

export function createMonteCarloEngine(
  config?: Partial<MonteCarloConfig>,
): PredictionEngine;
```

Engine flow:
1. Call `estimateLambdas(statistics)` to get expected goals.
2. Call `simulateMatch(lambdaHome, lambdaAway, { iterations: config.simulations, rho: config.rho })`.
3. For each market in `statistics.markets`:
   a. Classify market using `classifyMarket()` (reuse from weight-tuned — extract to shared utility).
   b. Get model probability from simulation results.
   c. Compute edge vs market price.
   d. Determine YES/NO side.
4. Select the market with the best edge (same pattern as weight-tuned).
5. Compute stake via fractional Kelly.
6. Build reasoning with simulation details.
7. Return `PredictionOutput[]`.

### `src/competitors/monte-carlo-poisson/types.ts` (new)

Zod schemas for config validation.

```typescript
export const monteCarloConfigSchema = z.object({
  simulations: z.number().int().min(1000).max(100_000).default(10_000),
  rho: z.number().min(-0.3).max(0.3).default(-0.04),
  kellyFraction: z.number().min(0).max(1).default(0.25),
  minEdge: z.number().min(0).max(0.5).default(0.03),
  maxBetPct: z.number().min(0).max(1).default(0.05),
  minBetPct: z.number().min(0).max(1).default(0.005),
});
```

### `src/competitors/shared/market-classification.ts` (new)

Extract `classifyMarket()` from `src/competitors/weight-tuned/engine.ts` into a shared location so both competitors can use it. The weight-tuned engine will import from here instead.

```typescript
export function classifyMarket(
  question: string,
  homeTeamName: string,
  awayTeamName: string,
): "home" | "away" | "draw";
```

### `src/competitors/weight-tuned/engine.ts` (modify)

Remove `classifyMarket` function body, replace with re-export from shared:

```typescript
export { classifyMarket } from "../shared/market-classification";
```

### `src/competitors/loader.ts` (modify)

Add the `monte-carlo-poisson` case to `loadSingleCompetitor`:

```typescript
case "monte-carlo-poisson": {
  let config = DEFAULT_MC_CONFIG;
  if (row.config) {
    try {
      const parsed = monteCarloConfigSchema.safeParse(JSON.parse(row.config));
      if (parsed.success) config = parsed.data;
    } catch {
      logger.info("Using default MC config for competitor (parse failed)", { id: row.id });
    }
  }
  return createMonteCarloEngine(config);
}
```

Note: Unlike weight-tuned which reads config from `competitor_versions`, MC-Poisson reads from the `config` column on the `competitors` table directly. No versioned weight iteration — the config is static and simple.

---

## Data & Migration

No schema changes needed. The existing `competitors` table already supports:
- `type: text` — will be `"monte-carlo-poisson"`
- `config: text` — JSON config column for `MonteCarloConfig`

A database seed/insert will be needed to register the competitor:

```sql
INSERT INTO competitors (id, name, type, model, status, config)
VALUES (
  'mc-poisson',
  'Monte Carlo Poisson',
  'monte-carlo-poisson',
  'statistical',
  'active',
  '{"simulations":10000,"rho":-0.04,"kellyFraction":0.25,"minEdge":0.03,"maxBetPct":0.05,"minBetPct":0.005}'
);
```

A wallet must also be set up for this competitor (same process as existing ones).

---

## Test Plan

### `tests/unit/competitors/monte-carlo-poisson/poisson.test.ts`

- **poissonPmf correctness**: known values (lambda=1, k=0 => 0.368; lambda=2.5, k=3 => 0.214)
- **poissonPmf edge cases**: lambda=0 returns 1 for k=0, 0 otherwise; very large k returns ~0
- **buildScoreMatrix sums to ~1.0**: total probability across matrix should be > 0.999
- **outcomeProbabilities**: for equal lambdas, draw probability should be highest or comparable; home+draw+away = 1.0
- **dixonColesAdjustment**: rho=0 returns 1.0 (no adjustment); negative rho increases 0-0 probability

### `tests/unit/competitors/monte-carlo-poisson/lambda.test.ts`

- **estimateLambdas with balanced teams**: lambdas close to league average
- **estimateLambdas with strong home team**: home lambda > away lambda significantly
- **formModifier**: "WWWWW" > 1.0; "LLLLL" < 1.0; "WDLWW" moderate; null returns 1.0
- **h2hModifier**: high-scoring H2H increases lambdas; no H2H returns 1.0
- **injuryModifier**: key attacker injured reduces lambda; no injuries returns 1.0
- **lambda clamping**: extreme inputs still produce lambdas in [0.3, 4.0]

### `tests/unit/competitors/monte-carlo-poisson/simulator.test.ts`

- **simulateMatch deterministic with seed**: same seed produces same result
- **simulateMatch probabilities sum to 1.0**: homeWinPct + drawPct + awayWinPct = 1.0
- **heavy favourite**: lambda 3.0 vs 0.5 produces > 80% home win probability
- **equal teams**: lambda 1.5 vs 1.5 produces roughly equal home/away with notable draw %
- **score distribution**: most probable scores are reasonable (1-0, 1-1, 2-1 etc.)

### `tests/unit/competitors/monte-carlo-poisson/engine.test.ts`

- **returns PredictionOutput[] matching schema**: output passes Zod validation
- **no bet when edge is below minEdge**: returns empty array
- **bets on correct side**: when model says home win 70% and market has YES at 0.50, bets YES
- **stake sizing via Kelly**: higher edge produces larger stake; stake within [minBetPct, maxBetPct]
- **handles missing optional data gracefully**: no injuries, no season stats, no player stats
- **reasoning includes simulation details**: lambda values, simulation counts, probabilities

### `tests/unit/competitors/shared/market-classification.test.ts`

- Move existing `classifyMarket` tests from weight-tuned tests (if any) to shared location
- Same test cases, just verifying the shared function works

### `tests/unit/competitors/loader.test.ts` (modify)

- **loads monte-carlo-poisson type**: verify `loadSingleCompetitor` creates engine for this type
- **uses default config when config column is null**
- **parses custom config from config column**

---

## Task Breakdown

- [x] Create `src/competitors/shared/market-classification.ts` — extract `classifyMarket()` from weight-tuned engine
- [x] Update `src/competitors/weight-tuned/engine.ts` — import `classifyMarket` from shared instead of defining locally
- [x] Add `tests/unit/competitors/shared/market-classification.test.ts` — move/copy classify tests
- [x] Verify existing tests still pass after the `classifyMarket` extraction
- [x] Create `src/competitors/monte-carlo-poisson/poisson.ts` — Poisson PMF, CDF, score matrix, outcome probabilities, Dixon-Coles adjustment
- [x] Add `tests/unit/competitors/monte-carlo-poisson/poisson.test.ts`
- [x] Create `src/competitors/monte-carlo-poisson/lambda.ts` — lambda estimation with form, H2H, injury modifiers
- [x] Add `tests/unit/competitors/monte-carlo-poisson/lambda.test.ts`
- [x] Create `src/competitors/monte-carlo-poisson/simulator.ts` — Monte Carlo match simulator with seeded PRNG
- [x] Add `tests/unit/competitors/monte-carlo-poisson/simulator.test.ts`
- [x] Create `src/competitors/monte-carlo-poisson/types.ts` — Zod config schema and defaults
- [x] Create `src/competitors/monte-carlo-poisson/engine.ts` — main engine combining lambda estimation, simulation, market evaluation, and Kelly staking
- [x] Add `tests/unit/competitors/monte-carlo-poisson/engine.test.ts`
- [x] Update `src/competitors/loader.ts` — add `monte-carlo-poisson` case to `loadSingleCompetitor`
- [x] Update `tests/unit/competitors/loader.test.ts` — add test for loading MC-Poisson type
- [x] Run full test suite (`bun test`) and typecheck (`bun run typecheck`) to verify everything passes
- [ ] Insert competitor record into production database and set up wallet
