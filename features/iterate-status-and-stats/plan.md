# Plan: Add Status Guard to Iteration & Expand Feedback Prompt Stats

**Date:** 2026-03-04
**Status:** Complete

---

## Overview

Two changes to the weight iteration flow:

1. **Status guard:** `iterateCompetitor()` currently iterates any competitor that exists, regardless of status. Add a check so only `active` and `pending` competitors are iterated. `iterateAll()` should also include `pending` competitors (currently only fetches `active`).
2. **Expand feedback prompt stats:** Add `lockedAmount`, `totalStaked`, and `totalReturned` to the performance data sent to the LLM in the feedback prompt. These are already available from `getPerformanceStats()` but currently filtered out.

---

## Approach

### Status Guard

Add an early return in `iterateCompetitor()` that rejects competitors not in `active` or `pending` status. Define the allowed statuses as a constant for clarity. Update `iterateAll()` to fetch both `active` and `pending` competitors.

### Expanded Stats

Extend the `PerformanceStats` type in `feedback.ts` with three new fields. Pass them through from `iteration.ts`. Add them to the prompt text in `buildFeedbackPrompt()`.

### Trade-offs

- **Allowing `pending` iteration:** This enables the cold-start path (initial weight generation) for newly-added competitors before they're switched to `active`. If we only allowed `active`, a new competitor would need to be activated before it could get its first weights, which is a chicken-and-egg problem.
- **Not adding `pending` and `failed` bet counts to the prompt:** Per user direction. These stats could be useful but would add noise — the LLM can't influence bet execution reliability.

---

## Changes Required

### `src/competitors/weight-tuned/iteration.ts`

**1. Status guard in `iterateCompetitor()`**

After the existence check (line 114), add a status check:

```typescript
const ITERABLE_STATUSES = new Set(["active", "pending"]);

async function iterateCompetitor(competitorId: string): Promise<WeightIterationResult> {
  const competitor = await competitors.findById(competitorId);
  if (!competitor) {
    return { success: false, competitorId, error: `Competitor ${competitorId} not found` };
  }

  if (!ITERABLE_STATUSES.has(competitor.status)) {
    return {
      success: false,
      competitorId,
      error: `Competitor ${competitorId} has status "${competitor.status}" — only active and pending competitors can be iterated`,
    };
  }

  // ... rest of function unchanged
```

**2. Update `iterateAll()` to include `pending` competitors**

Currently fetches only `active`. Change to fetch both and merge:

```typescript
async function iterateAll(): Promise<WeightIterationResult[]> {
  const [active, pending] = await Promise.all([
    competitors.findByStatus("active"),
    competitors.findByStatus("pending"),
  ]);
  const all = [...active, ...pending];
  const weightTuned = all.filter((c) => c.type === "weight-tuned");

  // ... rest unchanged
```

**3. Pass new stats fields to `buildWeightFeedbackPrompt()`**

Update the `performance` object in `iterateCompetitor()` (around line 135):

```typescript
performance: {
  totalBets: stats.totalBets,
  wins: stats.wins,
  losses: stats.losses,
  accuracy: stats.accuracy,
  roi: stats.roi,
  profitLoss: stats.profitLoss,
  lockedAmount: stats.lockedAmount,
  totalStaked: stats.totalStaked,
  totalReturned: stats.totalReturned,
},
```

### `src/competitors/weight-tuned/feedback.ts`

**1. Extend `PerformanceStats` type** (line 20):

```typescript
export type PerformanceStats = {
  totalBets: number;
  wins: number;
  losses: number;
  accuracy: number;
  roi: number;
  profitLoss: number;
  lockedAmount: number;
  totalStaked: number;
  totalReturned: number;
};
```

**2. Also extend `FeedbackPromptInput`** — no change needed, since it already references `PerformanceStats`.

**3. Update the prompt text in `buildFeedbackPrompt()`** (line 185-191):

Add the three new stats to the "Your Performance Summary" section:

```typescript
## Your Performance Summary

- Total Bets: ${performance.totalBets}
- Wins: ${performance.wins} | Losses: ${performance.losses}
- Accuracy: ${formatPercentage(performance.accuracy)}
- ROI: ${formatPercentage(performance.roi)}
- Profit/Loss: ${formatCurrency(performance.profitLoss)}
- Total Staked: ${formatCurrency(performance.totalStaked)}
- Total Returned: ${formatCurrency(performance.totalReturned)}
- Locked in Active Bets: ${formatCurrency(performance.lockedAmount)}
```

### `tests/unit/competitors/weight-tuned/iteration.test.ts`

Add tests for the status guard behaviour:

**New test: rejects disabled competitor**
```typescript
test("returns error for disabled competitor", async () => {
  const deps = createMockDeps({
    competitorsRepo: {
      ...mockCompetitorsRepo,
      findById: mock(() => Promise.resolve({ ...COMPETITOR, status: "disabled" })),
    },
  });
  const service = createWeightIterationService(deps);
  const result = await service.iterateCompetitor("wt-test");
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error).toContain("disabled");
  }
});
```

**New test: rejects error-state competitor**
```typescript
test("returns error for error-state competitor", async () => {
  // same pattern, status: "error"
});
```

**New test: allows pending competitor**
```typescript
test("allows iteration for pending competitor", async () => {
  const deps = createMockDeps({
    competitorsRepo: {
      ...mockCompetitorsRepo,
      findById: mock(() => Promise.resolve({ ...COMPETITOR, status: "pending" })),
    },
  });
  const service = createWeightIterationService(deps);
  const result = await service.iterateCompetitor("wt-test");
  expect(result.success).toBe(true);
});
```

**Update `iterateAll` test:** Update the mock to verify that `findByStatus` is called for both `"active"` and `"pending"`.

### `tests/unit/competitors/weight-tuned/feedback.test.ts`

Update any existing tests that construct `PerformanceStats` objects to include the three new fields (`lockedAmount`, `totalStaked`, `totalReturned`). Add a test that verifies these new stats appear in the rendered prompt text.

---

## Test Plan

| Test | Scenario | Asserts |
|------|----------|---------|
| Status: disabled rejected | `iterateCompetitor()` with `status: "disabled"` | Returns `success: false`, error mentions status |
| Status: error rejected | `iterateCompetitor()` with `status: "error"` | Returns `success: false`, error mentions status |
| Status: pending allowed | `iterateCompetitor()` with `status: "pending"` | Returns `success: true`, LLM is called |
| Status: active allowed | Existing test already covers this | No change needed |
| iterateAll includes pending | `iterateAll()` with active + pending competitors | Both are iterated |
| Prompt includes new stats | Build feedback prompt with `totalStaked`, `totalReturned`, `lockedAmount` | Rendered prompt contains "Total Staked", "Total Returned", "Locked in Active Bets" |

---

## Task Breakdown

- [x] Add `ITERABLE_STATUSES` constant and status guard to `iterateCompetitor()` in `src/competitors/weight-tuned/iteration.ts`
- [x] Update `iterateAll()` in `iteration.ts` to fetch both `active` and `pending` competitors
- [x] Add `lockedAmount`, `totalStaked`, `totalReturned` to `PerformanceStats` type in `src/competitors/weight-tuned/feedback.ts`
- [x] Add the three new fields to the prompt text in `buildFeedbackPrompt()` in `feedback.ts`
- [x] Pass the three new fields through in the `performance` object in `iterateCompetitor()` in `iteration.ts`
- [x] Add status guard tests (disabled rejected, error rejected, pending allowed) in `tests/unit/competitors/weight-tuned/iteration.test.ts`
- [x] Update `iterateAll` test to verify pending competitors are included in `iteration.test.ts`
- [x] Update `PerformanceStats` objects in `tests/unit/competitors/weight-tuned/feedback.test.ts` with new fields and add prompt content assertion
- [x] Run `bun test` to verify all tests pass
