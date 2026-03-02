# Review: Bankroll-Relative Staking & Pre-Bet Validation

**Reviewed:** 2026-03-02
**Reviewer:** Claude (Principal Engineer Review)
**Plan:** [plan.md](./plan.md)
**Verdict:** APPROVED

## Summary

The feature converts the engine's stake output from absolute dollar amounts to bankroll fractions (0-1), adds a bankroll provider that computes available funds from DB state, and wires in pre-bet stake validation in the prediction pipeline. The implementation follows the plan closely, all 376 tests pass, and all review items from the initial pass have been addressed in commit `e5b3346`.

## Review History

- **Initial review (2026-03-02):** APPROVED WITH CHANGES -- 2 must-do, 4 should-do items flagged
- **Follow-up (2026-03-02):** All 6 items resolved in `e5b3346`. Verdict upgraded to APPROVED.

## Findings

### Architecture & Design -- Pass

The data flow matches the plan: engine outputs fractions, pipeline fetches bankroll, resolves to absolute dollars, validates, then places bet. The `BankrollProvider` is correctly placed in `src/domain/services/bankroll.ts`.

Previously flagged layer violation resolved: `validateStake` was moved from `src/competitors/weight-tuned/stake-validator.ts` to `src/domain/services/stake-validator.ts`. The orchestrator now imports from the domain layer, not from a specific competitor's module.

`PlaceBetInput` now has a separate `resolvedStake: number` field (`betting.ts:18`), cleanly separating the engine's fractional stake from the absolute dollar amount used for bet placement. The prediction is passed through untouched.

### TypeScript & Type Safety -- Pass

The semantic type mismatch has been resolved. The pipeline passes `prediction` (with its 0-1 fraction `stake`) untouched to `PlaceBetInput.prediction`, and the resolved dollar amount goes through `PlaceBetInput.resolvedStake` (`prediction-pipeline.ts:351-352`). The betting service uses `resolvedStake` for `clampStake` (`betting.ts:73`). No Zod schema boundary violations.

No unused imports remain. The old `stake-validator.ts` was deleted entirely.

### Data Validation & Zod -- Pass

- `predictionOutputSchema` correctly uses `z.number().min(0).max(1)` for fractional stakes.
- `stakeConfigSchema` correctly validates `maxBetPct` and `minBetPct` as 0-1 fractions.
- Zod types are inferred with `z.infer<>`, not duplicated.

### Database & Drizzle ORM -- Pass

- Bankroll provider reads via existing `betsRepo.findByCompetitor()` -- no new queries.
- Predictions saved with resolved absolute amounts (`prediction-pipeline.ts:319`).
- No migrations needed -- backwards compatible.

### Security -- Pass

- No secrets exposed in logs or error messages.
- Wallet config handling unchanged.
- Bankroll provider only reads aggregate bet data.

### Testing -- Pass

376 tests pass, 0 fail. Two new tests added to `pipeline.test.ts`:

- `pipeline.test.ts:721-742`: "records error and skips competitor when bankroll fetch fails" -- verifies error is recorded, predictions not generated, and `placeBet` not called when `getBankroll` rejects.
- `pipeline.test.ts:744-766`: "skips bet and increments betsSkipped when stake validation fails" -- uses 50% stake fraction against 10% pipeline cap, verifies prediction is saved but bet is rejected and `placeBet` is not called.

The `bankroll.test.ts` covers: no bets, pending/filled exposure, settled wins/losses, combined P&L + exposure, negative bankroll clamping, and cancelled bet exclusion. The `validator.test.ts` covers all `validateStake` rejection paths.

### Error Handling & Resilience -- Pass

- Bankroll fetch failures caught and logged with competitor ID (`prediction-pipeline.ts:291-296`).
- Stake validation rejections logged with full context (`prediction-pipeline.ts:335-344`).
- One competitor's failure doesn't block others.

### Code Quality & Conventions -- Pass

- No unused imports or dead code.
- `minBetAmount` extracted from hardcoded value to `BettingConfig.minBetAmount` (`betting.ts:12`, `config.ts:47`), used via `config.betting.minBetAmount` (`prediction-pipeline.ts:331`).
- `validateStake` lives in `src/domain/services/stake-validator.ts`, correctly positioned in the domain layer.
- Clean separation: `PlaceBetInput` carries both `prediction` (engine output) and `resolvedStake` (pipeline-resolved amount).

### Operational Concerns -- Pass

- Logging includes structured context with IDs and amounts at every decision point.
- One DB call per competitor per fixture for bankroll -- acceptable performance.
- `initialBankroll: 100` in config matches the old hardcoded value. No behaviour change at launch.
- Backwards compatible -- no migration needed.

## What's Done Well

- **Clean type boundary**: `PlaceBetInput.resolvedStake` separates the engine's fractional stake from the dollar amount, preventing the semantic type mismatch that was the main risk.
- **Domain-layer validator**: Moving `validateStake` to `src/domain/services/` respects the architecture -- the orchestrator imports from domain, not from specific competitors.
- **Config-driven constraints**: `minBetAmount` is now in `BettingConfig` rather than hardcoded, making it testable and adjustable.
- **Comprehensive test coverage**: Both new error paths (bankroll failure, stake validation rejection) have dedicated tests that verify correct behaviour including negative assertions (`placeBet` not called).
- **Predictions always saved**: The pipeline saves predictions before validation/betting, so no prediction data is lost.
- **Bankroll provider edge cases**: `Math.max(0, ...)` prevents negative bankroll. Cancelled bets excluded. Pending/filled exposure subtracted.

## Must-Do Changes

All items resolved:

- [x] **Fix semantic type mismatch in bet placement**: Added `resolvedStake: number` to `PlaceBetInput` (`betting.ts:18`). Pipeline passes prediction untouched + resolved amount separately (`prediction-pipeline.ts:351-352`). Betting service uses `resolvedStake` (`betting.ts:73`).
- [x] **Remove unused import**: Old `src/competitors/weight-tuned/stake-validator.ts` deleted. New file has no unused imports.

## Should-Do Changes

All items resolved:

- [x] **Extract `minBetAmount` to config**: Added to `BettingConfig` (`betting.ts:12`), defaulted in `config.ts:47`, used in pipeline (`prediction-pipeline.ts:331`).
- [x] **Move `validateStake` to domain layer**: Now at `src/domain/services/stake-validator.ts`. Imported by pipeline and test from domain path.
- [x] **Add test for bankroll fetch failure**: `pipeline.test.ts:721-742` verifies error recording and competitor skip.
- [x] **Add test for stake validation rejection**: `pipeline.test.ts:744-766` verifies prediction saved but bet skipped.
