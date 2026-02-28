# Single Bet Per Fixture

## Context

Each football fixture on Polymarket has 3 moneyline markets: "Will Home win?", "Will Away win?", "Will it end in a draw?". Currently the pipeline iterates over each market, calls the engine 3 times per fixture, and places 3 separate bets. We want the engine to analyse the match once and place ONE bet on the best outcome.

## Root Cause

`src/orchestrator/pipeline.ts` lines 254-321 loop `for (const matchedMarket of matched.markets)` and call `runAllEngines()` inside that loop. The `Statistics` type only has a single `market: MarketContext` field, so engines never see all three markets at once.

---

## Changes

### 1. Change Statistics contract: `market` → `markets`

**`src/domain/contracts/statistics.ts`**

Replace `market: marketContextSchema` with `markets: z.array(marketContextSchema).min(1)`.

This changes `Statistics.market` to `Statistics.markets: MarketContext[]`.

### 2. Restructure pipeline loop

**`src/orchestrator/pipeline.ts`**

Instead of iterating per market then calling engines, build `markets: MarketContext[]` from all matched markets for the fixture, create ONE `Statistics` object, call `runAllEngines` once. After getting predictions, look up the original `Market` object by `prediction.marketId` to pass to `bettingService.placeBet`.

### 3. Update baseline engine

**`src/competitors/baseline/engine.ts`**

Change `statistics.market` → `statistics.markets[0]`. Baseline always targets the first market (home win). Minimal change — its heuristic already computes home-win probability.

### 4. Update LLM runtime engine

**`src/competitors/llm-runtime/engine.ts`**

- Update `buildPredictionPrompt` to list ALL markets in the prompt
- Update system prompt to instruct: "Choose ONE market that represents the best value bet. Return a single prediction."
- Change `statistics.market` references → `statistics.markets`

### 5. Update codegen generator

**`src/competitors/llm-codegen/generator.ts`** — Update type definitions in `CODEGEN_SYSTEM_PROMPT` to show `markets: MarketContext[]` and update example code.

**`src/competitors/llm-codegen/sample-statistics.ts`** — Change `market: {...}` to `markets: [{...}]`.

### 6. Update test-pipeline script

**`src/scripts/test-pipeline.ts`** — Change `market:` to `markets:` in Statistics construction.

### 7. Update tests

- `tests/unit/domain/contracts/statistics.test.ts` — `market` → `markets: [...]`
- `tests/unit/competitors/baseline/engine.test.ts` — `market` → `markets: [...]`
- `tests/unit/competitors/llm-runtime/engine.test.ts` — update prompt tests for multi-market output
- `tests/unit/engine/runner.test.ts` — `market` → `markets: [...]`
- `tests/unit/orchestrator/pipeline.test.ts` — engine called once per fixture, not once per market

---

## Files Touched

| File | Action |
|------|--------|
| `src/domain/contracts/statistics.ts` | Edit — `market` → `markets` array |
| `src/orchestrator/pipeline.ts` | Edit — restructure loop: one engine call per fixture |
| `src/competitors/baseline/engine.ts` | Edit — use `statistics.markets[0]` |
| `src/competitors/llm-runtime/engine.ts` | Edit — list all markets in prompt, pick one |
| `src/competitors/llm-codegen/generator.ts` | Edit — update type defs in prompt |
| `src/competitors/llm-codegen/sample-statistics.ts` | Edit — `market` → `markets: [...]` |
| `src/scripts/test-pipeline.ts` | Edit — `market` → `markets` |
| `tests/unit/domain/contracts/statistics.test.ts` | Edit |
| `tests/unit/competitors/baseline/engine.test.ts` | Edit |
| `tests/unit/competitors/llm-runtime/engine.test.ts` | Edit |
| `tests/unit/engine/runner.test.ts` | Edit |
| `tests/unit/orchestrator/pipeline.test.ts` | Edit |

## Not Changed

- `src/domain/contracts/prediction.ts` — `PredictionOutput` unchanged (already has `marketId`)
- `src/engine/runner.ts` — passes `Statistics` through opaquely
- `src/domain/services/betting.ts` — receives `Market` from pipeline, not `Statistics`
- `src/domain/services/market-matching.ts` — already groups markets under fixtures

## Verification

1. `bun run typecheck` — no type errors
2. `bun test` — all tests pass
3. `bun run lint` — no lint errors
4. Run pipeline — each fixture produces 1 prediction per engine, not 3
