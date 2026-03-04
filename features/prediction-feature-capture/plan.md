# Plan: Capture extracted features per prediction for LLM feedback

**Date:** 2026-03-04
**Status:** Draft

---

## Overview

The weight-tuned engine computes normalised feature scores (0-1) for each prediction — `homeWinRate=0.43`, `formDiff=0.50`, `h2h=0.15` — but these values are only partially captured in the reasoning text and never surfaced in the LLM feedback loop. Without knowing _what feature values produced each outcome_, the LLM tunes weights blind: it sees that a bet lost but can't tell whether `h2h=15%` was based on 2 meetings or 20.

This plan adds explicit storage of extracted feature values per prediction and surfaces them in the weight iteration feedback prompt, closing the feedback loop so the LLM can reason about the relationship between feature inputs and outcomes.

**Scope:** v1 stores extracted feature scores (Layer 1). Raw underlying stats (Layer 2 — e.g. "h2h based on 2 meetings") are deferred to a follow-up.

---

## Approach

**Store all 20 feature values per prediction** in a dedicated nullable JSON column on the `predictions` table. The engine already computes features via `extractFeatures()` — we attach the full feature map to `PredictionOutput`, and the pipeline persists it.

At iteration time, `buildRecentOutcomes` reads the stored features and includes them in the feedback prompt so the LLM sees feature values alongside each outcome.

### Why this approach

- **Dedicated column vs. mining reasoning JSON:** The reasoning `sections[1].data` already contains active feature values, but only for non-zero-weight signals, and it's buried in nested JSON. A top-level column is explicit, queryable, and includes all features (active and inactive) so the LLM can see opportunities to activate zero-weight signals.
- **All features vs. active-only:** Storing all 20 features costs minimal storage (~400 bytes JSON per prediction) and lets the LLM spot high-value inactive features. e.g., "defensiveStrength=0.82 but weight=0, and I lost" → LLM may choose to activate it.
- **Revert `activeSignals` optimisation in engine:** The recent simplify run added `activeSignals` filtering to skip zero-weight feature extraction. Since we now want all features for storage, the engine call reverts to `extractFeatures(statistics)` (no filter). The `activeSignals` parameter stays on `extractFeatures` for other callers but the engine doesn't use it. Feature extraction is pure arithmetic (no I/O), so computing 17 extra extractors per fixture is negligible.

### Trade-offs

- **Larger predictions rows:** ~400 bytes of JSON per prediction. With hundreds of predictions this is kilobytes — irrelevant for SQLite.
- **Longer feedback prompts:** Showing features per outcome adds tokens. Mitigated by only showing features for settled (won/lost) outcomes, limiting to last 20 outcomes, and using a compact format.
- **PredictionOutput contract change:** Adding `extractedFeatures` to the shared contract couples it to the weight-tuned concept of "features." Mitigated by making it optional — other engine types can ignore it.
- **Deferred Layer 2:** Raw stats (h2h.totalMatches, homeRecord.played, etc.) are not captured in v1. The LLM sees feature scores but not sample sizes or data quality. This can be added later if feature-only feedback proves insufficient.

---

## Changes Required

### `src/domain/contracts/prediction.ts`

Add optional `extractedFeatures` to `predictionOutputSchema`:

```typescript
export const predictionOutputSchema = z.object({
  marketId: z.string(),
  side: z.enum(["YES", "NO"]),
  confidence: z.number().min(0).max(1),
  stake: z.number().min(0).max(1),
  reasoning: reasoningSchema,
  extractedFeatures: z.record(z.string(), z.number()).optional(),
});
```

This keeps the field optional — engines that don't produce features won't break validation.

### `src/infrastructure/database/schema.ts`

Add nullable JSON column to `predictions` table:

```typescript
extractedFeatures: text("extracted_features", { mode: "json" })
  .$type<Record<string, number>>(),
```

### Migration: `drizzle/NNNN_*.sql`

```sql
ALTER TABLE predictions ADD COLUMN extracted_features TEXT;
```

### `src/competitors/weight-tuned/engine.ts`

Two changes:

1. **Revert `activeSignals` filter on `extractFeatures` call** — compute all features for storage:

```typescript
// Before (optimised for computation only):
const features = extractFeatures(statistics, activeSignals);

// After (all features for storage, weighted sum still only uses non-zero):
const features = extractFeatures(statistics);
```

2. **Attach features to output:**

```typescript
return [
  {
    marketId: best.market.marketId,
    side: best.side,
    confidence: clamp(best.confidence, 0, 1),
    stake: stakeFraction,
    reasoning,
    extractedFeatures: features,
  },
];
```

The `activeSignals` Set is no longer needed in the outer scope. Remove it. The `signalEntries` variable (used for reasoning summary) can filter `features` directly:

```typescript
const signalEntries = Object.entries(features).filter(
  ([name]) => (weights.signals[name] ?? 0) > 0,
);
```

This is already what the code does — it never depended on `activeSignals` for the reasoning section.

### `src/competitors/weight-tuned/features.ts`

Remove the `activeSignals` parameter from `extractFeatures`. It was only added for the engine optimisation which we're reverting. Return to the original signature:

```typescript
export function extractFeatures(statistics: Statistics): Record<string, number> {
  const features: Record<string, number> = {};
  for (const [name, entry] of Object.entries(FEATURE_REGISTRY)) {
    features[name] = entry.extract(statistics);
  }
  return features;
}
```

### `src/orchestrator/prediction-pipeline.ts`

Store extracted features when saving predictions. In `processFixture`, after the engine returns results:

```typescript
await predictionsRepo.create({
  marketId: prediction.marketId,
  fixtureId: fixture.id,
  competitorId,
  side: prediction.side,
  confidence: prediction.confidence,
  stake: absoluteStake,
  reasoning: prediction.reasoning,
  extractedFeatures: prediction.extractedFeatures ?? null,
});
```

### `src/competitors/weight-tuned/feedback.ts`

1. **Extend `PredictionOutcome` type** to include optional features and the weight config that produced it:

```typescript
export type PredictionOutcome = {
  marketQuestion: string;
  side: "YES" | "NO";
  confidence: number;
  stake: number;
  result: "won" | "lost" | "pending";
  profit: number | null;
  extractedFeatures?: Record<string, number>;
};
```

2. **Add feature formatting for feedback prompt.** New function to format features per outcome:

```typescript
function formatOutcomeFeatures(
  features: Record<string, number>,
  weights: Record<string, number>,
): string {
  return Object.entries(features)
    .filter(([name]) => (weights[name] ?? 0) > 0)
    .map(([name, val]) => `${name}=${(val * 100).toFixed(0)}% (w=${weights[name]?.toFixed(2)})`)
    .join(", ");
}
```

3. **Update `formatOutcomesTable`** (or replace with block format) to include features for settled outcomes. For compactness, show features as an inline summary below each settled outcome row rather than a full table:

```typescript
function formatOutcomesWithFeatures(
  outcomes: PredictionOutcome[],
  signalWeights: Record<string, number>,
): string {
  if (outcomes.length === 0) return "No predictions yet.";

  const parts: string[] = [];
  for (const o of outcomes) {
    const resultEmoji = o.result === "won" ? "WIN" : o.result === "lost" ? "LOSS" : "PENDING";
    const profitStr = o.profit !== null ? formatCurrency(o.profit) : "-";
    let block = `**${o.marketQuestion}** → ${o.side} | Confidence: ${formatPercentage(o.confidence)} | Stake: ${o.stake.toFixed(1)} | ${resultEmoji} | P&L: ${profitStr}`;

    if (o.extractedFeatures && o.result !== "pending") {
      block += `\n  Features: ${formatOutcomeFeatures(o.extractedFeatures, signalWeights)}`;
    }
    parts.push(block);
  }
  return parts.join("\n\n");
}
```

4. **Update `WeightFeedbackInput`** to pass signal weights through:

```typescript
export type WeightFeedbackInput = {
  currentWeights: WeightConfig;
  performance: PerformanceStats;
  recentOutcomes: PredictionOutcome[];
  leaderboard: LeaderboardEntry[];
};
```

No change needed to this type — `currentWeights.signals` already available. The `buildWeightFeedbackPrompt` function passes `currentWeights.signals` to the new `formatOutcomesWithFeatures`.

5. **Update instructions section** in feedback prompt to mention feature analysis:

Add to the "Focus on" list:
```
6. Feature values that correlated with wins vs losses — which features were reliable indicators?
```

### `src/competitors/weight-tuned/iteration.ts`

Update `buildRecentOutcomes` to include extracted features from stored predictions:

```typescript
outcomes.push({
  marketQuestion: market?.question ?? pred.marketId,
  side: pred.side,
  confidence: pred.confidence,
  stake: pred.stake,
  result,
  profit,
  extractedFeatures: pred.extractedFeatures ?? undefined,
});
```

The `pred` object from `predictionsRepo.findByCompetitor` already includes `extractedFeatures` from the DB (nullable JSON column). TypeScript will type it correctly via Drizzle inference.

### `src/infrastructure/database/repositories/predictions.ts`

No changes needed — the `create` method accepts `typeof predictions.$inferInsert` which will automatically include the new column. The `findByCompetitor` query returns all columns including the new one.

---

## Data & Migration

**Migration:** Single additive `ALTER TABLE` — safe for SQLite. Existing predictions get `NULL` for `extracted_features`. No data backfill needed; only new predictions will have feature data.

**Backwards compatibility:** The column is nullable and the `PredictionOutput` field is optional. Old predictions work fine. The feedback prompt gracefully handles missing features (skips the feature line).

---

## Test Plan

### `tests/unit/competitors/weight-tuned/engine.test.ts`

- **"includes extractedFeatures in output"** — Create engine with known weights, run on sample statistics, verify output includes `extractedFeatures` with all 20 feature keys and values in 0-1 range.
- **"extractedFeatures includes zero-weight features"** — Verify features for zero-weight signals are still present in output (not filtered out).

### `tests/unit/competitors/weight-tuned/feedback.test.ts`

- **"formatOutcomeFeatures shows active features with weights"** — Given features and weights, verify output includes active features with scores and weights, excludes zero-weight features.
- **"feedback prompt includes features for settled outcomes"** — Build full feedback prompt with outcomes that have extractedFeatures, verify feature data appears in the output for won/lost outcomes but not for pending.
- **"feedback prompt handles outcomes without features"** — Verify graceful handling when `extractedFeatures` is undefined (old predictions).

### `tests/unit/competitors/weight-tuned/iteration.test.ts`

- **"buildRecentOutcomes includes extractedFeatures from DB"** — Mock predictionsRepo to return predictions with extractedFeatures, verify they appear in the built outcomes.

### `tests/unit/competitors/weight-tuned/validator.test.ts`

- **Existing tests pass unchanged** — The validator constructs an engine and runs it; the output now includes `extractedFeatures` which should pass validation (optional field).

### `tests/unit/orchestrator/pipeline.test.ts`

- **"stores extractedFeatures when saving prediction"** — Verify the pipeline passes `extractedFeatures` to `predictionsRepo.create`.

---

## Task Breakdown

- [x] Generate migration: `ALTER TABLE predictions ADD COLUMN extracted_features TEXT`
- [x] Add `extractedFeatures` column to `predictions` in `src/infrastructure/database/schema.ts`
- [x] Add optional `extractedFeatures` field to `predictionOutputSchema` in `src/domain/contracts/prediction.ts`
- [x] Revert `activeSignals` optimisation in `src/competitors/weight-tuned/engine.ts` — call `extractFeatures(statistics)` without filter, remove `activeSignals` Set, attach `extractedFeatures: features` to output
- [x] Revert `activeSignals` parameter from `extractFeatures` in `src/competitors/weight-tuned/features.ts` — back to original no-parameter signature
- [x] Update `src/orchestrator/prediction-pipeline.ts` to pass `prediction.extractedFeatures` when creating prediction records
- [x] Extend `PredictionOutcome` in `src/competitors/weight-tuned/feedback.ts` with optional `extractedFeatures`
- [x] Add `formatOutcomeFeatures` function in `feedback.ts`
- [x] Update `formatOutcomesTable` (or create `formatOutcomesWithFeatures`) to include features for settled outcomes
- [x] Pass signal weights into outcome formatting in `buildWeightFeedbackPrompt`
- [x] Update feedback prompt instructions to mention feature analysis
- [x] Update `buildRecentOutcomes` in `src/competitors/weight-tuned/iteration.ts` to include `extractedFeatures` from stored predictions
- [x] Add engine test: output includes extractedFeatures with all feature keys
- [x] Add feedback test: features shown for settled outcomes, omitted for pending
- [x] Add iteration test: extractedFeatures flows through from DB to outcomes
- [x] Update pipeline test: extractedFeatures passed to predictionsRepo.create
- [x] Run full test suite, verify all existing tests still pass
