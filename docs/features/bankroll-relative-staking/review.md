# Review: Bankroll-Relative Staking & Pre-Bet Validation

**Reviewed:** 2026-03-02
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** [plan.md](./plan.md)
**Verdict:** APPROVED WITH CHANGES

## Summary

The feature converts the engine's stake output from absolute dollar amounts to bankroll fractions (0-1), adds a bankroll provider that computes available funds from DB state, and wires in pre-bet stake validation in the prediction pipeline. The implementation follows the plan closely and all 374 tests pass. There is one semantic type-safety issue that should be addressed before merge: the pipeline passes absolute dollar amounts through a field typed as a 0-1 fraction.

## Findings

### Architecture & Design -- Concern

The overall data flow matches the plan: engine outputs fractions, pipeline fetches bankroll, resolves to absolute dollars, validates, then places bet. The `BankrollProvider` is correctly placed in `src/domain/services/bankroll.ts`.

One layer concern: the orchestrator (`prediction-pipeline.ts:1`) imports `validateStake` directly from `src/competitors/weight-tuned/stake-validator.ts`. This validator is now generic (it takes `stake: number, bankroll: number, constraints`) and isn't specific to the weight-tuned competitor. It would be better housed in `src/domain/services/` so the orchestrator doesn't reach into a specific competitor's module.

The plan said to remove `clampStake` from `betting.ts` but it was retained (`betting.ts:44-46`). Keeping it as a safety net is fine -- the betting service still needs an absolute dollar cap.

### TypeScript & Type Safety -- Concern

**Semantic type mismatch (the one must-do):** The `predictionOutputSchema` (`prediction.ts:7`) now defines `stake` as `z.number().min(0).max(1)` -- i.e. a fraction. But at `prediction-pipeline.ts:351`, the pipeline passes `{ ...prediction, stake: absoluteStake }` to `bettingService.placeBet()`, where `absoluteStake` is an absolute dollar amount (e.g. $5). The `PlaceBetInput.prediction` field is typed as `PredictionOutput`, which implies stake is 0-1.

This works today because TypeScript doesn't enforce Zod range constraints at compile time (`stake: number` allows any number). But it's semantically wrong and fragile -- if anyone adds Zod validation at the betting service boundary, bets above $1 will all fail. The fix: pass the resolved stake as a separate field on `PlaceBetInput` (e.g. `resolvedStake: number`) rather than mutating the prediction's stake field.

Unused import at `stake-validator.ts:1`: `StakeConfig` is imported but never used.

### Data Validation & Zod -- Pass

- `predictionOutputSchema` correctly updated to `z.number().min(0).max(1)` for fractional stakes.
- `stakeConfigSchema` correctly updated to have `maxBetPct` and `minBetPct` both as 0-1 fractions.
- `weightConfigSchema` unchanged and still valid.
- The bankroll provider doesn't validate its output with Zod, but since it's internal and the output is a simple computed number, this is acceptable.

### Database & Drizzle ORM -- Pass

- The bankroll provider reads from the bets table via the existing `betsRepo.findByCompetitor()` -- no new queries.
- Predictions are saved with the resolved absolute amount (`prediction-pipeline.ts:319`), which matches the plan's guidance that historical records store absolute values.
- No schema migrations needed -- `stake` was already a numeric column, and the values just change from engine fractions to resolved dollar amounts in the pipeline before saving.

### Security -- Pass

- No secrets exposed in logs or error messages.
- Wallet config handling unchanged.
- The bankroll provider only reads aggregate bet data, no sensitive fields.

### Testing -- Concern

Tests are solid overall. 374 tests pass, 0 fail. The new `bankroll.test.ts` covers: no bets, pending/filled exposure, settled wins/losses, combined P&L + exposure, negative bankroll clamping, and cancelled bet exclusion. The `validator.test.ts` covers all `validateStake` rejection paths (zero, negative, below minimum, exceeds percentage, exceeds bankroll, depleted bankroll).

**Missing coverage:** The bankroll fetch failure path in the prediction pipeline (`prediction-pipeline.ts:291-296`) has error handling code but no test exercises it. A test should verify that when `bankrollProvider.getBankroll()` rejects, the pipeline records the error and continues to the next competitor.

The pipeline test at `pipeline.test.ts:475-493` ("always saves predictions regardless of bet outcome") exercises the validation skip path indirectly via the betting service returning `{ status: "skipped" }`, but doesn't test the new `validateStake` rejection path explicitly. This means the `betsSkipped` counter increment at `prediction-pipeline.ts:343` is tested indirectly but not through the actual validation branch.

### Error Handling & Resilience -- Pass

- Bankroll fetch failures are caught and logged with the competitor ID (`prediction-pipeline.ts:291-296`), skipping to the next competitor.
- Stake validation rejections are logged with full context: competitorId, fixtureId, marketId, reason, requestedStake, and bankroll (`prediction-pipeline.ts:335-344`).
- One competitor's bankroll failure doesn't block other competitors (the `continue` at line 296 only skips the current competitor).

### Code Quality & Conventions -- Concern

- Unused import: `stake-validator.ts:1` imports `StakeConfig` but doesn't use it. This is dead code.
- Hardcoded `minBetAmount: 0.01` at `prediction-pipeline.ts:332` should be a config value or derived from the betting config, not a magic number buried in the pipeline.
- The `validateStake` return type `{ valid: boolean; reason?: string }` works but could be a discriminated union (`{ valid: true } | { valid: false; reason: string }`) for better type narrowing. Minor -- current usage with `if (!validation.valid)` is fine.

### Operational Concerns -- Pass

- Logging is good: bankroll fetch, stake rejection, and pipeline summary all include structured context with IDs and amounts.
- The bankroll provider makes one DB call per competitor per fixture (`findByCompetitor`), which is acceptable. No N+1 issues.
- The `initialBankroll` config value (`config.ts:47`) defaults to 100, matching the old hardcoded value. No behaviour change at launch.
- No migration needed -- backwards compatible.

## What's Done Well

- **Clean separation of concerns**: The bankroll provider is a focused service with a single responsibility. It takes `betsRepo` via DI, computes the result from DB state, and floors at zero.
- **Predictions always saved**: The pipeline saves predictions to DB before attempting validation or bet placement (`prediction-pipeline.ts:312-326`), so no prediction data is lost even if the bet is rejected.
- **Comprehensive edge-case handling in bankroll**: `Math.max(0, ...)` prevents negative bankroll. Cancelled bets are correctly excluded. Pending/filled exposure is correctly subtracted.
- **Thorough test coverage for new code**: `bankroll.test.ts` and the updated `validator.test.ts` (stake validation) cover the important scenarios including boundary values.
- **Validator refactor is clean**: `validateStake` now takes primitive args (`stake, bankroll, constraints`) instead of `PredictionOutput`, making it reusable and easy to test.
- **Engine output is now a pure fraction**: The engine no longer needs to know about bankroll, which is the right abstraction boundary.

## Must-Do Changes

These MUST be addressed before merging:

- [ ] **Fix semantic type mismatch in bet placement** (`prediction-pipeline.ts:351`): The pipeline passes `{ ...prediction, stake: absoluteStake }` where `absoluteStake` is a dollar amount, but `PredictionOutput.stake` is defined as a 0-1 fraction. Add a `resolvedStake: number` field to `PlaceBetInput` and use that in the betting service instead of overwriting the prediction's stake. This prevents a subtle bug if Zod validation is ever added at the betting service boundary.
- [ ] **Remove unused import** (`stake-validator.ts:1`): `StakeConfig` is imported but never referenced. Remove it.

## Should-Do Changes

Recommended but not blocking:

- [ ] **Extract `minBetAmount` to config** (`prediction-pipeline.ts:332`): The hardcoded `0.01` should come from `config.betting` (e.g. `minBetAmount: 0.01`) rather than being a magic number in the pipeline.
- [ ] **Move `validateStake` to domain layer**: `src/competitors/weight-tuned/stake-validator.ts` is now generic and imported by the orchestrator. Consider moving it to `src/domain/services/stake-validator.ts` since it's no longer weight-tuned-specific.
- [ ] **Add test for bankroll fetch failure**: The error path at `prediction-pipeline.ts:291-296` should have a dedicated test in `pipeline.test.ts` -- mock `bankrollProvider.getBankroll()` to reject and verify the error is recorded and the competitor is skipped.
- [ ] **Add test for stake validation rejection in pipeline**: A test that verifies when `validateStake` returns `{ valid: false }` (e.g. stake exceeds `maxBetPctOfBankroll`), the pipeline increments `betsSkipped` and doesn't call `bettingService.placeBet()`.

## Questions for the Author

- The `clampStake` function remains in `betting.ts` and applies `maxStakePerBet` as an absolute dollar cap. Is the intent that both the bankroll-percentage validation (in the pipeline) AND the absolute dollar cap (in the betting service) apply? If so, the order is: pipeline validates percentage, then betting service clamps to dollar max. This seems right but worth confirming the double-gating is intentional.
- Is there a plan to make `initialBankroll` per-competitor rather than global? The current config has a single value (`config.betting.initialBankroll: 100`), but different competitors could be seeded with different starting bankrolls.
