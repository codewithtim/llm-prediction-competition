# Plan: Redesign LLM feedback prompt for effective weight optimisation

**Date:** 2026-03-04
**Status:** Implemented

---

## Overview

The LLM is a **weight optimizer** — it never sees actual football, only aggregate results from how its weight configuration performed. The quality of the feedback payload determines whether it improves or random-walks. The current feedback prompt shows individual bet outcomes (last 20) and a flat performance summary, but lacks two critical elements:

1. **Round-by-round performance history** — the LLM only sees cumulative stats and recent outcomes. It has no sense of trend across iterations, so it can't detect patterns like "every time I increase homeAdvantage above 0.3, results get worse."
2. **Signal-outcome correlation analysis** — the LLM sees feature values per bet (added in prediction-feature-capture) but must do its own correlation analysis. Pre-computing which signals correlated with wins vs losses gives the LLM something directly actionable.

This plan redesigns the feedback prompt with accumulated round history, signal correlation summaries, and explicit anti-overreaction guardrails in the system prompt.

---

## Approach

### Core idea

Restructure the iteration feedback around **performance rounds** rather than flat bet lists. A "round" is **iteration-scoped** — each time `bun run iterate` runs, the delta between the current cumulative stats and the previous version's snapshot defines the round. This is the natural boundary: each version ran with a specific weight config, and the bets settled since the last iteration are the results of that config.

The LLM sees the last N rounds as a time series with explicit sample sizes and date ranges, plus aggregated signal correlation data — not just individual bet outcomes.

**Why iteration-scoped, not gameweek-scoped:** The system covers multiple leagues with non-aligned gameweeks. Grouping by gameweek would require fixture-level matchday data that doesn't exist in the schema. Iteration boundaries are already recorded via `competitor_versions.generatedAt` and the snapshot deltas are trivial to compute. The LLM compensates for variable round sizes because each round includes its sample size (e.g. "8 bets settled") — the anti-overreaction rules tell it to discount small-sample rounds.

### Three changes

1. **Round-based performance history** — Store a performance round snapshot at each iteration in `competitor_versions.performanceSnapshot`. Enhance the snapshot to include round-level metrics (bets settled since last iteration, win/loss record, P&L, avg edge, signal correlations). Include date ranges so the LLM knows the time span each round covers. At feedback time, load the last 10 versions and build a history section showing trends.

2. **Signal-outcome correlation analysis** — After bets resolve, compute which features drove winning vs losing predictions. Aggregate these across settled bets and present them as "Signals that correlated with wins" and "Signals that correlated with losses" in the feedback prompt.

3. **Anti-overreaction prompt engineering** — Rewrite the system prompt and feedback instructions to explicitly frame the LLM as a weight optimizer that must resist overcorrecting on small samples. Add rules about incremental adjustments, trend-based reasoning, and conservatism when P&L is positive.

### Why this approach over alternatives

- **Pre-computed correlations vs raw feature dumps**: Showing the LLM "your wins were driven mostly by formDiff, your losses by h2h" is more actionable than raw per-bet feature tables. The LLM doesn't have to mentally aggregate across 20 outcomes.
- **Round history vs cumulative stats only**: Cumulative accuracy/ROI masks trends. A competitor could be at 55% accuracy overall but have gone 1W/4L in the last two rounds. Round history lets the LLM see trajectory.
- **Enhanced snapshot vs separate table**: Enriching the existing `performanceSnapshot` JSON column is simpler than creating a new `iteration_rounds` table. The data is already scoped per-version.

### Trade-offs

- **Longer feedback prompts**: Round history + correlations adds tokens. Mitigated by capping to 10 rounds and using compact formatting. The incremental token cost (~500-800 extra tokens) is negligible relative to the LLM call cost.
- **Correlation quality depends on sample size**: With 5 bets per round, signal correlations can be noisy. The prompt explicitly tells the LLM not to trust small samples and to look at trends across 3+ rounds.
- **Richer snapshot is not backfilled**: Old `performanceSnapshot` rows lack round-level fields. The feedback builder handles this gracefully by skipping rounds with incomplete data. After 2-3 iterations, all recent rounds will have full data.
- **No per-version bet tracking**: We compute correlations from all settled bets at iteration time, not from "bets placed during version N." This is simpler but means the LLM can't distinguish which bets were placed under which weight config. Acceptable for v1 — the version boundaries are implicit in the round timestamps.

---

## Changes Required

### `src/infrastructure/database/schema.ts`

Extend the `PerformanceSnapshot` type to include round-level metrics. The column type stays the same (JSON text) — only the shape grows.

```typescript
export type PerformanceSnapshot = {
  totalBets: number;
  wins: number;
  losses: number;
  accuracy: number;
  roi: number;
  profitLoss: number;
  lockedAmount: number;
  totalStaked: number;
  totalReturned: number;
  // New round-level fields (absent on old snapshots).
  // "Round" = bets settled between this iteration and the previous one.
  roundWins?: number;
  roundLosses?: number;
  roundPnl?: number;
  avgEdgeAtBet?: number;
  winningSignals?: string[];
  losingSignals?: string[];
};
```

No migration needed — the column is already `text({ mode: "json" })`. Old rows simply lack the new optional fields.

### `src/competitors/weight-tuned/feedback.ts`

Major rewrite of the feedback prompt builder. This is the core of the change.

**New types:**

```typescript
export type PerformanceRound = {
  version: number;
  dateFrom: string;       // previous iteration date (or competitor creation)
  dateTo: string;         // this iteration date
  betsSettled: number;    // settled since last iteration
  wins: number;
  losses: number;
  pnl: number;
  avgEdge: number;
  winningSignals: string[];
  losingSignals: string[];
};
```

**New function — `computeSignalCorrelations`:**

Computes which signals most strongly correlated with wins vs losses across a set of settled outcomes. For each settled bet that has `extractedFeatures`, compute contribution = `weight * featureValue` for each active signal. Aggregate across wins and losses separately. Return the top 3 signals by average contribution for each group.

```typescript
export function computeSignalCorrelations(
  outcomes: PredictionOutcome[],
  signalWeights: Record<string, number>,
): { winningSignals: string[]; losingSignals: string[] } {
  const settled = outcomes.filter(
    (o) => o.result !== "pending" && o.extractedFeatures,
  );
  const wins = settled.filter((o) => o.result === "won");
  const losses = settled.filter((o) => o.result === "lost");

  function topSignals(group: PredictionOutcome[]): string[] {
    if (group.length === 0) return [];
    const totals: Record<string, number> = {};
    for (const o of group) {
      for (const [name, value] of Object.entries(o.extractedFeatures!)) {
        if ((signalWeights[name] ?? 0) > 0) {
          totals[name] = (totals[name] ?? 0) + signalWeights[name] * value;
        }
      }
    }
    // Average and sort
    return Object.entries(totals)
      .map(([name, total]) => ({ name, avg: total / group.length }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 3)
      .map((s) => s.name);
  }

  return {
    winningSignals: topSignals(wins),
    losingSignals: topSignals(losses),
  };
}
```

**New function — `formatPerformanceHistory`:**

Formats rounds into the multi-round history section for the prompt.

```typescript
function formatPerformanceHistory(rounds: PerformanceRound[]): string {
  if (rounds.length === 0) return "No performance history yet.";

  return rounds
    .map(
      (r) => `Round ${r.version} (${r.dateFrom} → ${r.dateTo}, ${r.betsSettled} bets settled):
- Record: ${r.wins}W / ${r.losses}L
- P&L: ${formatCurrency(r.pnl)}
- Avg edge at bet time: ${formatPercentage(r.avgEdge)}
- Signals correlated with wins: ${r.winningSignals.length > 0 ? r.winningSignals.join(", ") : "insufficient data"}
- Signals correlated with losses: ${r.losingSignals.length > 0 ? r.losingSignals.join(", ") : "insufficient data"}`,
    )
    .join("\n\n");
}
```

**Rewrite `buildWeightFeedbackPrompt`:**

Restructured prompt with this layout:

```
## Your Role
[Weight optimizer framing — you never see football, only aggregate results]

## Current Configuration
[JSON + formatted table — existing]

## Performance History
[Round-by-round view, last 10 rounds]

## Overall Performance
[Cumulative stats — existing]

## Recent Prediction Outcomes (last 20)
[Per-bet details with features — existing]

## Leaderboard
[Existing]

## Rules
[Anti-overreaction rules — new]

## Instructions
[Updated to reference trends and signal correlations]
```

The **Rules** section is new and contains the anti-overreaction guardrails:

```
## Rules

- Do NOT overreact to a single bad matchday. Look at trends across multiple rounds.
- Small incremental adjustments (±0.05) are better than large swings unless
  performance is consistently poor across 3+ rounds.
- If a signal has been consistently unhelpful across 3+ rounds, consider
  reducing it significantly.
- If overall P&L is positive, be conservative with changes.
- If you have fewer than 10 settled bets total, make only minor adjustments —
  you don't have enough data to draw strong conclusions.
- Track your reasoning — what did you change and why?
```

### `src/competitors/weight-tuned/iteration.ts`

**Enhance `iterateCompetitor`** to:

1. Compute signal correlations from recent outcomes before building the feedback prompt.
2. Compute round-level metrics for the performance snapshot.
3. Load recent versions (last 10) and build the performance history from their snapshots.

**New function — `buildPerformanceHistory`:**

Loads the last 10 versions for a competitor and maps their `performanceSnapshot` fields into `PerformanceRound` objects. Each round's `dateFrom` is the previous version's `generatedAt` (or the competitor's `createdAt` for the first version), and `dateTo` is this version's `generatedAt`. Versions with old-format snapshots (no round-level fields) are skipped.

```typescript
async function buildPerformanceHistory(
  competitorId: string,
): Promise<PerformanceRound[]> {
  const allVersions = await versions.findByCompetitor(competitorId);
  const recent = allVersions.slice(0, 11); // +1 to derive dateFrom for the oldest round
  const rounds: PerformanceRound[] = [];

  for (let i = 0; i < recent.length - 1; i++) {
    const v = recent[i]!;
    const prev = recent[i + 1]!;
    const snap = v.performanceSnapshot;
    if (!snap || snap.roundWins === undefined) continue;

    rounds.push({
      version: v.version,
      dateFrom: prev.generatedAt.toISOString().split("T")[0],
      dateTo: v.generatedAt.toISOString().split("T")[0],
      betsSettled: (snap.roundWins ?? 0) + (snap.roundLosses ?? 0),
      wins: snap.roundWins ?? 0,
      losses: snap.roundLosses ?? 0,
      pnl: snap.roundPnl ?? 0,
      avgEdge: snap.avgEdgeAtBet ?? 0,
      winningSignals: snap.winningSignals ?? [],
      losingSignals: snap.losingSignals ?? [],
    });
  }

  return rounds.reverse(); // chronological order for display
}
```

**Enhance performance snapshot creation:**

When saving the new version, compute round-level stats by comparing current performance to the previous version's snapshot. The delta gives us "bets settled this round."

```typescript
const prevSnapshot = latestVersion?.performanceSnapshot;
const roundWins = prevSnapshot ? stats.wins - (prevSnapshot.wins ?? 0) : stats.wins;
const roundLosses = prevSnapshot ? stats.losses - (prevSnapshot.losses ?? 0) : stats.losses;
const roundPnl = prevSnapshot
  ? stats.profitLoss - (prevSnapshot.profitLoss ?? 0)
  : stats.profitLoss;
```

**Compute signal correlations:**

```typescript
const { winningSignals, losingSignals } = computeSignalCorrelations(
  recentOutcomes,
  currentWeights.signals,
);
```

**Update `WeightFeedbackInput`** to include the new data:

```typescript
export type WeightFeedbackInput = {
  currentWeights: WeightConfig;
  performance: PerformanceStats;
  recentOutcomes: PredictionOutcome[];
  leaderboard: LeaderboardEntry[];
  performanceHistory: PerformanceRound[];
  signalCorrelations: { winningSignals: string[]; losingSignals: string[] };
};
```

### `src/competitors/weight-tuned/generator.ts`

**Rewrite `WEIGHT_SYSTEM_PROMPT`** to frame the LLM as a weight optimizer:

```typescript
export const WEIGHT_SYSTEM_PROMPT = `You are optimizing a weight configuration for a football prediction engine. You never see individual matches — only aggregate results from how your weights performed.

## How The Engine Works

The engine computes a home-strength score as a weighted average of feature signals, then derives probabilities for home win, draw, and away win. It compares these to market prices to find value bets.

## Feature Signals (0-1 range, where 0.5 is neutral)

${buildFeatureDescriptions()}

## Required Output JSON Schema

You MUST respond with ONLY a valid JSON object matching this exact schema — no markdown, no code fences, no explanation:

\`\`\`json
${JSON.stringify(WEIGHT_JSON_SCHEMA.schema, null, 2)}
\`\`\`

## Strategy Guidance

- Signal weights are relative — they're normalized to sum to 1.0
- Set unused signals to 0.0 to disable them
- drawBaseline ~0.25 is typical for football; lower for leagues with fewer draws
- drawPeak ~0.5 means draws are most likely when teams are evenly matched
- Higher stakingAggression means betting more on every pick
- Higher edgeMultiplier means betting proportionally more when you see big edge
- Higher minEdge means being more selective (fewer but higher-conviction bets)
- confidenceThreshold prevents large bets on uncertain predictions
- Use a mix of signals for robustness; don't rely on just one

Generate an improved weight configuration based on the performance data provided.`;
```

Key change: opens with "You are optimizing a weight configuration" instead of "You are a football betting strategist." Subtle framing shift that reinforces the optimizer role.

### `src/competitors/weight-tuned/types.ts`

No changes needed. The `WeightConfig` type, `weightConfigSchema`, and `WEIGHT_JSON_SCHEMA` are already correct for the optimizer model.

### `src/competitors/weight-tuned/validator.ts`

No changes needed.

### `src/infrastructure/database/repositories/competitor-versions.ts`

No changes needed — `findByCompetitor` already returns all versions ordered desc by version number, which is exactly what `buildPerformanceHistory` needs.

---

## Data & Migration

**No migration required.** The `performanceSnapshot` column is a nullable JSON text field. New fields are added as optional properties on the TypeScript type. Old rows simply lack these fields and are gracefully handled.

**Backwards compatibility:** The feedback builder skips rounds without the new fields. After 2-3 iterations, all recent rounds will have complete data.

---

## Test Plan

### `tests/unit/competitors/weight-tuned/feedback.test.ts`

- **"computeSignalCorrelations returns top signals for wins and losses"** — Given outcomes with features where wins have high formDiff contribution and losses have high h2h contribution, verify the function returns the expected top signals.
- **"computeSignalCorrelations handles no settled bets"** — Returns empty arrays.
- **"computeSignalCorrelations excludes zero-weight signals"** — Signals with weight=0 don't appear in correlations even if feature values are high.
- **"formatPerformanceHistory formats rounds chronologically"** — Given 3 rounds, verify output contains all rounds in chronological order with correct formatting.
- **"buildWeightFeedbackPrompt includes performance history section"** — Build prompt with history rounds, verify "Performance History" section is present and contains round data.
- **"buildWeightFeedbackPrompt includes Rules section"** — Verify anti-overreaction rules appear in the output.
- **"buildWeightFeedbackPrompt includes signal correlations in instructions"** — Verify winning/losing signal names are referenced.

### `tests/unit/competitors/weight-tuned/iteration.test.ts`

- **"iterateCompetitor computes round-level delta in snapshot"** — Mock a previous version with a snapshot, verify the new version's snapshot contains correct `roundWins`, `roundLosses`, `roundPnl` as deltas.
- **"iterateCompetitor builds performance history from recent versions"** — Mock multiple versions with snapshots, verify the feedback prompt includes round history.
- **"iterateCompetitor computes signal correlations"** — Mock outcomes with features, verify correlations are passed to the feedback builder.

### Existing tests

- All existing engine, feedback, and iteration tests must continue to pass unchanged. The changes add new functionality without modifying existing function signatures (except `buildWeightFeedbackPrompt` which gains new optional fields on its input type).

---

## Task Breakdown

- [x] Extend `PerformanceSnapshot` type in `src/infrastructure/database/schema.ts` with optional round-level fields: `roundWins`, `roundLosses`, `roundPnl`, `avgEdgeAtBet`, `winningSignals`, `losingSignals`
- [x] Add `PerformanceRound` type to `src/competitors/weight-tuned/feedback.ts` — iteration-scoped with `dateFrom`/`dateTo` range and `betsSettled` count
- [x] Add `computeSignalCorrelations` function to `feedback.ts` — takes outcomes + signal weights, returns top 3 winning/losing signals
- [x] Add `formatPerformanceHistory` function to `feedback.ts` — formats rounds into prompt section
- [x] Rewrite `buildWeightFeedbackPrompt` in `feedback.ts` — new layout with Role framing, Performance History section, Rules section, and signal correlation references in Instructions
- [x] Update `WeightFeedbackInput` type to include `performanceHistory` and `signalCorrelations` fields
- [x] Add `buildPerformanceHistory` helper to `iteration.ts` — loads last 10 versions, derives date ranges from adjacent version timestamps, maps snapshots to `PerformanceRound` objects
- [x] Update `iterateCompetitor` in `iteration.ts` to compute round-level deltas for the performance snapshot (compare current stats to previous version's snapshot)
- [x] Update `iterateCompetitor` to compute signal correlations from recent outcomes
- [x] Update `iterateCompetitor` to build performance history and pass it to `buildWeightFeedbackPrompt`
- [x] Update `iterateCompetitor` to save enriched snapshot with round-level fields and signal correlations
- [x] Update `WEIGHT_SYSTEM_PROMPT` in `generator.ts` — reframe as weight optimizer, keep existing feature descriptions and schema
- [x] Add tests for `computeSignalCorrelations` — wins/losses, empty input, zero-weight exclusion
- [x] Add tests for `formatPerformanceHistory` — formatting, chronological order
- [x] Add tests for updated `buildWeightFeedbackPrompt` — history section, rules section, signal correlations
- [x] Add tests for `iterateCompetitor` — round delta computation, history building, correlation passing
- [x] Run full test suite, verify all existing tests pass
