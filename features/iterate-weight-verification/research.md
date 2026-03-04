# Research: Iterate Task — Weight Creation, Status Checks & Prompt Completeness

**Date:** 2026-03-04
**Scope:** Verifying three aspects of the iterate task: (1) initial weight creation via LLM, (2) status-based iteration guards, (3) completeness of stats passed to the LLM feedback prompt vs what the API provides.

---

## Overview

The iterate task (`bun run iterate`) triggers the weight iteration loop for weight-tuned competitors. It can iterate a single competitor or all active weight-tuned competitors. The flow gathers performance data, builds a feedback prompt, calls the LLM to generate improved weights, validates them, and saves a new version.

---

## Question 1: Does the iterate task initially create weights via LLM call?

**YES — confirmed.**

In `src/competitors/weight-tuned/iteration.ts:127-131`, the `iterateCompetitor()` function checks whether a latest version exists:

```typescript
if (!latestVersion) {
  generated = await generator.generateWeights({
    model: competitor.model,
    competitorId,
  });
}
```

When there is **no existing version** (cold start), it calls `generator.generateWeights()` (`src/competitors/weight-tuned/generator.ts:64-85`), which makes an LLM call via OpenRouter with:
- **System prompt:** Full explanation of the engine mechanics, all 20 feature signal descriptions, the JSON schema, and strategy guidance
- **User prompt:** `"Generate an optimal weight configuration for football match prediction. Be creative with your signal weights and parameters — try to find an edge that differs from a simple baseline approach."`
- **JSON schema enforcement** via `WEIGHT_JSON_SCHEMA`
- **Temperature:** 0.8

When there **is** an existing version (lines 132-152), it calls `generator.generateWithFeedback()` with performance data, outcomes, and leaderboard.

Both paths go through the same validation pipeline (`validator.ts`) before saving.

**Test coverage:** `tests/unit/competitors/weight-tuned/iteration.test.ts:138-147` confirms that `generateWeights` is called (not `generateWithFeedback`) when no version exists, and that version 1 is saved.

---

## Question 2: Does the iterate task check competitor status before iterating?

**Partially — `iterateAll()` checks, but `iterateCompetitor()` does not.**

### `iterateAll()` — STATUS CHECK EXISTS

`src/competitors/weight-tuned/iteration.ts:203-214`:

```typescript
async function iterateAll(): Promise<WeightIterationResult[]> {
  const active = await competitors.findByStatus("active");
  const weightTuned = active.filter((c) => c.type === "weight-tuned");
  // iterates only these
}
```

This correctly:
1. Fetches only competitors with `status === "active"`
2. Further filters to only `type === "weight-tuned"`

### `iterateCompetitor()` — NO STATUS CHECK

`src/competitors/weight-tuned/iteration.ts:112-116`:

```typescript
async function iterateCompetitor(competitorId: string): Promise<WeightIterationResult> {
  const competitor = await competitors.findById(competitorId);
  if (!competitor) {
    return { success: false, competitorId, error: `Competitor ${competitorId} not found` };
  }
  // proceeds regardless of status
}
```

It only checks if the competitor **exists** — it does NOT verify the competitor's status. A competitor with status `"disabled"`, `"pending"`, or `"error"` can still be iterated if called directly via `bun run iterate --competitor <id>`.

### Competitor Status Options

Defined in `src/domain/types/competitor.ts:1`:

```typescript
export const COMPETITOR_STATUSES = ["active", "disabled", "pending", "error"] as const;
```

| Status | Meaning |
|--------|---------|
| `active` | Competitor is live and participating in predictions/betting |
| `disabled` | Competitor has been manually deactivated |
| `pending` | Competitor is set up but not yet activated (e.g. awaiting wallet, initial weights) |
| `error` | Competitor encountered an error state |

**Note:** The database schema at `src/infrastructure/database/schema.ts:63` stores status as a free-text field with a default of `"active"`, NOT as an enum. The `CompetitorStatus` type is only enforced at the TypeScript level, not at the database level:

```typescript
status: text("status").notNull().default("active"),
```

---

## Question 3: Does the LLM prompt include all stats available from the API?

**NO — the feedback prompt is missing several stats that `getPerformanceStats()` returns.**

### Stats returned by `getPerformanceStats()` (`src/infrastructure/database/repositories/bets.ts:131-161`)

| Field | Description | Sent to LLM? | Sent via API? |
|-------|-------------|:------------:|:-------------:|
| `totalBets` | Total number of bets (all statuses) | YES | YES |
| `wins` | Settled won count | YES | YES |
| `losses` | Settled lost count | YES | YES |
| `accuracy` | wins / (wins + losses) | YES | YES |
| `roi` | (returned - staked) / staked | YES | YES |
| `profitLoss` | returned - staked | YES | YES |
| `pending` | Active bets (submitting/pending/filled) | NO | YES |
| `failed` | Failed bets count | NO | YES |
| `lockedAmount` | Capital locked in active bets | NO | YES |
| `totalStaked` | Total capital staked on settled bets | NO | YES |
| `totalReturned` | Total capital returned from settled bets | NO | YES |

### Where the filtering happens

In `src/competitors/weight-tuned/iteration.ts:122-141`, the `iterateCompetitor()` function calls `getPerformanceStats()` but only passes a subset to `buildWeightFeedbackPrompt()`:

```typescript
const stats = await bets.getPerformanceStats(competitorId);
// ...
const feedbackPrompt = buildWeightFeedbackPrompt({
  currentWeights,
  performance: {
    totalBets: stats.totalBets,
    wins: stats.wins,
    losses: stats.losses,
    accuracy: stats.accuracy,
    roi: stats.roi,
    profitLoss: stats.profitLoss,
  },
  // ...
});
```

The `PerformanceStats` type in `feedback.ts:20-27` is defined as:

```typescript
export type PerformanceStats = {
  totalBets: number;
  wins: number;
  losses: number;
  accuracy: number;
  roi: number;
  profitLoss: number;
};
```

This is a deliberately narrower type than what `getPerformanceStats()` returns.

### What the API exposes (dashboard/competitor endpoints)

Both `src/api/routes/dashboard.ts:43-53` and `src/api/routes/competitors.ts:33-43` send **all** stats to the frontend:

```typescript
stats: {
  totalBets: stats.totalBets,
  wins: stats.wins,
  losses: stats.losses,
  pending: stats.pending,
  failed: stats.failed,
  lockedAmount: stats.lockedAmount,
  totalStaked: stats.totalStaked,
  totalReturned: stats.totalReturned,
  profitLoss: stats.profitLoss,
  accuracy: stats.accuracy,
  roi: stats.roi,
}
```

### Assessment of missing stats

The missing stats (`pending`, `failed`, `lockedAmount`, `totalStaked`, `totalReturned`) could be useful to the LLM for understanding:

- **`totalStaked` / `totalReturned`**: Gives the LLM context on absolute capital at risk, not just percentages. Could inform staking aggression.
- **`pending`**: Tells the LLM how many bets are still in play — useful for understanding if performance data is representative.
- **`failed`**: High failure rate could indicate the LLM should adjust strategy (e.g. reduce stake sizes to avoid insufficient funds).
- **`lockedAmount`**: Capital currently tied up, affecting available bankroll.

---

## Summary of Key Facts

- **Initial weight creation:** Confirmed to work via LLM call (`generator.generateWeights()`) when no version exists. The system prompt includes all 20 feature signal descriptions and the full JSON schema.
- **Status check gap:** `iterateAll()` correctly filters to `active` + `weight-tuned` competitors. `iterateCompetitor(id)` does NOT check status — it will iterate any competitor that exists, regardless of status.
- **Competitor statuses:** `["active", "disabled", "pending", "error"]` — defined in `src/domain/types/competitor.ts:1`.
- **Missing stats in LLM prompt:** The feedback prompt omits `pending`, `failed`, `lockedAmount`, `totalStaked`, and `totalReturned` — all of which are available from `getPerformanceStats()` and exposed via the dashboard/competitor API routes.
- **The `PerformanceStats` type** in `feedback.ts` is the bottleneck — it only declares 6 fields. Expanding it would flow the data through to the prompt automatically, since `buildFeedbackPrompt()` directly renders all fields from the `performance` object.
