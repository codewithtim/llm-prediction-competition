# Research: LLM Weight Generation & Iteration Flow

**Date:** 2026-03-03

---

## Overview

The system uses a **weight-tuned competitor** architecture where LLMs don't make predictions directly — instead, they generate JSON weight configurations that tune a shared deterministic prediction engine. Each LLM competitor gets periodic feedback on its performance and generates improved weights.

---

## The Weight Config

Every competitor's "brain" is a `WeightConfig` (`src/competitors/weight-tuned/types.ts`):

```typescript
{
  signals: {                    // Feature weights (0-1), normalized to sum to 1.0
    homeWinRate: 0.4,
    formDiff: 0.3,
    h2h: 0.3,
    awayLossRate: 0.0,
    goalDiff: 0.0,
    pointsPerGame: 0.0,
    defensiveStrength: 0.0,
    injuryImpact: 0.0,
    cleanSheetDiff: 0.0,
    scoringConsistency: 0.0,
  },
  drawBaseline: 0.25,          // Base draw probability
  drawPeak: 0.5,               // Home strength where draw is most likely
  drawWidth: 0.15,             // Width of draw probability Gaussian curve
  confidenceThreshold: 0.52,   // Min confidence for aggressive staking
  minEdge: 0.05,               // Min edge over market to consider betting
  stakingAggression: 0.5,      // Base staking level (0-1)
  edgeMultiplier: 2.0,         // How much edge amplifies stake
  kellyFraction: 0.25,         // Fraction of Kelly criterion
}
```

---

## Production Flow — End to End

### 1. Startup: Load Competitors & Register Engines

**Entry:** `src/index.ts` → `src/competitors/loader.ts`

1. Fetch all active competitors from the `competitors` table
2. For each **weight-tuned** competitor:
   - Fetch the latest version from `competitor_versions` table
   - Parse the stored JSON weight config
   - Call `createWeightedEngine(weights, stakeConfig)` to create a `PredictionEngine` function
3. Register each engine in the in-memory `CompetitorRegistry`
4. Load wallet configs (decrypted private keys for Polymarket trading)

At this point, the system has a map of `competitorId → engine function` ready to run.

### 2. Prediction Pipeline (every 15 minutes)

**Entry:** `src/orchestrator/scheduler.ts` → `src/orchestrator/prediction-pipeline.ts`

**Phase 1 — Fixture Discovery & Stats Pre-fetch:**
- Find fixtures ready for prediction (within `predictionLeadTimeMs` of kickoff, default 30 min)
- Pre-fetch in parallel: standings, team stats, H2H history, injuries, season stats

**Phase 2 — Prediction & Betting:**

For each fixture:

1. Refresh market odds from Gamma (Polymarket API)
2. Build a `Statistics` object containing all fixture data
3. Call `runAllEngines(engines, statistics)` — runs every registered competitor's engine

**Inside each engine** (`src/competitors/weight-tuned/engine.ts`):

```
Statistics → extractFeatures() → 10 feature signals (0-1 each)
                                      ↓
                            weighted average using signal weights
                                      ↓
                              homeStrength (0-1)
                                      ↓
                         ┌────────────┼────────────┐
                         ↓            ↓            ↓
                     pHome        drawProb       pAway
                   (strength)   (Gaussian)   (1-strength)
                         ↓
               For each market: compare model prob vs market price
                         ↓
                    edge = modelProb - impliedProb
                         ↓
                  Pick market with best edge
                         ↓
              Calculate stake fraction via Kelly-like formula
                         ↓
              Return PredictionOutput { marketId, side, confidence, stake }
```

4. For each prediction output: resolve absolute stake, validate, place bet via `bettingService.placeBet()`

### 3. Bet Lifecycle

```
submitting → pending → filled → settled_won
                                settled_lost
          → failed (→ retry)
```

- **Order Confirmation** (every 5 min): Checks on-chain if pending orders are filled
- **Bet Retry** (every 10 min): Retries failed bets (up to max attempts, skipping terminal errors)
- **Settlement** (every 2 hours): Checks if markets are closed, determines winner (YES/NO price ≥ 0.99), calculates profit/loss

### 4. Weight Iteration (manual trigger)

**Entry:** `bun run iterate` → `src/scripts/iterate.ts`

This is currently a **manual CLI command**, not part of the automated scheduler.

**Flow for each weight-tuned competitor:**

```
┌─────────────────────────────────────────────────┐
│ 1. Load current weights from latest version     │
│ 2. Gather performance data:                     │
│    - getPerformanceStats() → accuracy, ROI, P&L │
│    - buildRecentOutcomes() → last 20 bet results│
│    - buildLeaderboard() → all competitors ranked│
└────────────────────┬────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│ 3. Build feedback prompt containing:            │
│    - Current weight config (JSON)               │
│    - Performance summary table                  │
│    - Recent outcomes table (market, side,        │
│      confidence, stake, result, profit)          │
│    - Leaderboard (rank, accuracy, ROI, P&L)     │
│    - Pattern analysis suggestions:              │
│      · YES/NO bet win rates                     │
│      · High-confidence loss detection           │
│      · Stake sizing on wins vs losses           │
└────────────────────┬────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│ 4. Call LLM via OpenRouter:                     │
│    - System prompt: explains engine mechanics,  │
│      feature signals, parameter meanings,       │
│      strategy guidance                          │
│    - User prompt: the feedback prompt above     │
│    - JSON schema: enforced output structure     │
│    - Temperature: 0.8                           │
│    - Model: competitor's assigned model         │
│      (e.g. claude-3.5-sonnet, gpt-4, etc.)     │
└────────────────────┬────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│ 5. Validate generated weights:                  │
│    a. Zod schema validation (ranges, types)     │
│    b. Runtime engine test with sample stats     │
│    c. Output validation (predictions schema,    │
│       stake within configured range)            │
└────────────────────┬────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│ 6. Save & activate:                             │
│    - Store new version in competitor_versions   │
│      (with version number, raw LLM output,      │
│       performance snapshot at time of iteration) │
│    - Unregister old engine from registry        │
│    - Register new engine with updated weights   │
└─────────────────────────────────────────────────┘
```

**First iteration** (no existing version): calls `generateWeights()` with just the system prompt and a generic "generate optimal weights" user prompt — no feedback data.

**Subsequent iterations**: calls `generateWithFeedback()` with the full feedback prompt including performance data, outcomes, and leaderboard.

---

## Key Files

| File | Role |
|------|------|
| `src/competitors/weight-tuned/types.ts` | WeightConfig schema, defaults, JSON schema for LLM |
| `src/competitors/weight-tuned/engine.ts` | The deterministic prediction engine (weights → predictions) |
| `src/competitors/weight-tuned/features.ts` | Feature extraction from statistics (10 signals) |
| `src/competitors/weight-tuned/generator.ts` | LLM calls via OpenRouter (initial + with feedback) |
| `src/competitors/weight-tuned/feedback.ts` | Builds the feedback prompt with performance data |
| `src/competitors/weight-tuned/iteration.ts` | Orchestrates the iteration loop |
| `src/competitors/weight-tuned/validator.ts` | Validates LLM output (schema + runtime test) |
| `src/competitors/loader.ts` | Loads competitors on startup, creates engines |
| `src/competitors/registry.ts` | In-memory engine registry |
| `src/engine/runner.ts` | Runs all engines against statistics |
| `src/orchestrator/prediction-pipeline.ts` | Main prediction + betting pipeline |
| `src/orchestrator/scheduler.ts` | Schedules all pipelines |
| `src/scripts/iterate.ts` | CLI entry point for weight iteration |

---

## What the LLM Sees

### System Prompt (always sent)

Explains:
- How the engine works (weighted average → probabilities → edge detection)
- What each feature signal measures
- The exact JSON schema it must produce
- Strategy guidance (what each parameter controls)

### User Prompt — Initial Generation

> "Generate an optimal weight configuration for football match prediction. Be creative with your signal weights and parameters — try to find an edge that differs from a simple baseline approach."

### User Prompt — Iteration (feedback)

Contains:
1. **Current weights** — full JSON + formatted table
2. **Performance summary** — total bets, wins, losses, accuracy, ROI, P&L
3. **Recent outcomes table** — last 20 predictions with market question, side, confidence, stake, result, profit
4. **Leaderboard** — all competitors ranked by P&L
5. **Pattern analysis** — automated suggestions like "your YES bets are underperforming" or "high-confidence losses detected"
6. **Instructions** — analyze patterns in wins/losses, calibrate confidence, adjust stake sizing, learn from competitors

### LLM Output

A JSON object matching `WeightConfig` — signal weights, draw parameters, staking parameters. No free text, no explanations.

---

## Current Gaps / Observations

1. **Iteration is manual** — `bun run iterate` must be run by hand. Not yet scheduled.
2. **No minimum data threshold** — iteration can happen with 0 settled bets (performance stats would all be zero).
3. **No A/B testing** — old weights are immediately replaced. No way to compare new vs old on the same fixtures.
4. **Sequential iteration** — competitors iterate one at a time. Could be parallelized since they're independent.
5. **Temperature 0.8** — relatively high, meaning significant variation between runs. Could lead to unstable iteration.
6. **No rollback** — if new weights perform worse, there's no automatic revert mechanism. The next iteration relies on the LLM recognizing poor performance and correcting.
7. **Leaderboard is global** — every competitor sees all others' performance, which could lead to convergent strategies.
