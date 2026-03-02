# Bankroll-Relative Staking & Pre-Bet Validation

## Problem

Stakes are currently computed against a **hardcoded** `bankroll: 100` in `DEFAULT_STAKE_CONFIG`. The engine produces an absolute dollar amount, the betting service clamps it to `maxStakePerBet`, and the order goes out — with no awareness of the competitor's actual wallet balance. If a competitor's bankroll has dwindled to $5, the system will still try to place a $5 bet (5% of the phantom $100), which is reckless relative to what they actually have.

Additionally, the `stake-validator.ts` file exists but is never called anywhere in the pipeline.

## Goals

1. **Engine outputs stake as a percentage of bankroll** (0–1), not an absolute dollar amount
2. **Bankroll is fetched from chain** (or estimated from DB) before each prediction run
3. **Pre-bet validation** rejects bets that exceed a configurable percentage of the current bankroll, returning a clear error so the pipeline can log it and move on
4. **Wire in the existing `stake-validator.ts`** so it actually runs before bet placement

---

## Current Flow (What Changes)

```
Engine → PredictionOutput { stake: $4.50 }
  ↓
Prediction Pipeline → saves prediction, calls bettingService.placeBet()
  ↓
Betting Service → clampStake(4.50, maxStakePerBet=10) → $4.50
  ↓
BettingClient → placeOrder(amount: 4.50)
```

### Proposed Flow

```
Prediction Pipeline → fetches current bankroll for competitor
  ↓
Engine → PredictionOutput { stake: 0.045 }   ← percentage (4.5% of bankroll)
  ↓
Prediction Pipeline → resolves absolute stake: 0.045 × bankroll
  ↓
Prediction Pipeline → validates stake against bankroll constraints
  ↓ (pass)
Betting Service → placeBet() with resolved absolute amount
  ↓
BettingClient → placeOrder(amount: resolved)

  ↓ (fail — e.g. stake > maxBetPct of bankroll)
Pipeline logs rejection reason, skips bet, continues to next prediction
```

---

## Implementation Plan

### Step 1: Add a bankroll provider

**New file: `src/domain/services/bankroll.ts`**

A service that resolves the current bankroll for a competitor. Two strategies:

1. **DB-estimated bankroll** (default, no external calls): Starting bankroll (from config) plus sum of all settled profits/losses minus pending exposure. This uses data we already have in the `bets` table.

   ```
   bankroll = initialBankroll + Σ(settled profits) - Σ(pending bet amounts)
   ```

2. **On-chain balance** (future enhancement, out of scope for this change): Query the Polymarket/Polygon USDC balance for the competitor's wallet address. This would be more accurate but requires an RPC call per competitor per run.

The service should expose:

```typescript
type BankrollProvider = {
  getBankroll(competitorId: string): Promise<number>;
};
```

For now, implement strategy 1 only. It needs `betsRepo` and a per-competitor `initialBankroll` config value.

**Config change**: Add `initialBankroll: number` to `BettingConfig` in `src/orchestrator/config.ts`, default `100`. This replaces the `bankroll` field in `StakeConfig`.

### Step 2: Change engine stake output to a fraction

**Modify: `src/competitors/weight-tuned/engine.ts`**

The engine currently computes:
```typescript
let stake = maxBet * rawStakeFraction * confidenceMultiplier;
stake = Math.max(stakeConfig.minBet, Math.min(stake, maxBet));
```

Change this so the engine returns a **fraction** (0–1) representing the desired percentage of bankroll:
```typescript
const stakeFraction = clamp(
  stakeConfig.maxBetPct * rawStakeFraction * confidenceMultiplier,
  0,
  stakeConfig.maxBetPct,
);
```

The output `stake` field in `PredictionOutput` becomes a fraction (e.g. `0.035` = 3.5% of bankroll).

**Modify: `src/domain/contracts/prediction.ts`**

Update the schema validation:
```typescript
stake: z.number().min(0).max(1)  // was: z.number().positive()
```

**Modify: `src/competitors/weight-tuned/types.ts`**

Remove `bankroll` from `StakeConfig` — it no longer belongs to the engine. Keep `maxBetPct` and `minBet` (which now becomes `minBetPct`):
```typescript
StakeConfig = {
  maxBetPct: 0.05,   // max 5% of bankroll per bet
  minBetPct: 0.005,  // min 0.5% of bankroll per bet
}
```

### Step 3: Resolve absolute stake in the prediction pipeline

**Modify: `src/orchestrator/prediction-pipeline.ts`**

Before running engines for a fixture, fetch each competitor's bankroll:

```typescript
const bankroll = await bankrollProvider.getBankroll(competitorId);
```

After the engine returns predictions, resolve the fraction to an absolute dollar amount:

```typescript
const absoluteStake = prediction.stake * bankroll;
```

This resolved amount is what gets passed to the betting service and saved in the prediction record.

**Important**: The prediction saved to DB should store the **absolute resolved amount**, not the fraction, so historical records remain meaningful. Add a `stakePct` column to the `predictions` table if we want to preserve both.

### Step 4: Wire in stake validation before bet placement

**Modify: `src/orchestrator/prediction-pipeline.ts`**

After resolving the absolute stake but **before** calling `bettingService.placeBet()`, run the existing `validateStake()`:

```typescript
import { validateStake } from "../competitors/weight-tuned/stake-validator";

const validation = validateStake(
  { ...prediction, stake: absoluteStake },
  bankroll,
  stakeConstraints,
);

if (!validation.valid) {
  logger.warn("Prediction: stake rejected", {
    competitorId,
    fixtureId: fixture.id,
    marketId: prediction.marketId,
    reason: validation.reason,
    requestedStake: absoluteStake,
    bankroll,
  });
  result.betsSkipped++;
  continue;  // skip to next prediction
}
```

### Step 5: Add a max single-bet percentage constraint to BettingConfig

**Modify: `src/orchestrator/config.ts`**

Add a hard ceiling that the pipeline enforces regardless of what the engine requests:

```typescript
betting: {
  maxStakePerBet: 10,         // absolute dollar cap (safety net)
  maxBetPctOfBankroll: 0.10,  // hard cap: no single bet > 10% of bankroll
  maxTotalExposure: 100,      // total pending exposure cap
  initialBankroll: 100,       // starting bankroll per competitor
  dryRun: false,
}
```

The validation in step 4 checks `absoluteStake <= bankroll * maxBetPctOfBankroll`. If a competitor's engine is tuned with `maxBetPct: 0.20` but the pipeline cap is `0.10`, the pipeline wins and the bet is rejected with a clear log message.

### Step 6: Update stake-validator to handle the new constraint

**Modify: `src/competitors/weight-tuned/stake-validator.ts`**

Add the bankroll-percentage check:

```typescript
const maxAllowed = bankroll * constraints.maxBetPct;
if (prediction.stake > maxAllowed) {
  return {
    valid: false,
    reason: `Stake $${prediction.stake.toFixed(2)} exceeds ${(constraints.maxBetPct * 100).toFixed(0)}% ` +
            `of bankroll $${bankroll.toFixed(2)} (max $${maxAllowed.toFixed(2)})`,
  };
}
```

Also add a minimum bankroll check — if the bankroll is below some threshold (e.g. $1), reject all bets:

```typescript
if (bankroll < constraints.minBet) {
  return {
    valid: false,
    reason: `Bankroll $${bankroll.toFixed(2)} is below minimum bet threshold`,
  };
}
```

### Step 7: Update tests

**Modify existing tests:**
- `tests/unit/competitors/engine.test.ts` — assert engine returns fractions (0–1), not dollar amounts
- `tests/unit/domain/services/betting.test.ts` — update expectations for absolute amounts

**New tests:**
- `tests/unit/domain/services/bankroll.test.ts` — test DB-estimated bankroll calculation (initial + settled P&L - pending exposure)
- `tests/unit/competitors/stake-validator.test.ts` — test all rejection paths (exceeds max pct, exceeds bankroll, bankroll too low, below min bet)
- Update prediction pipeline tests to verify the full flow: engine fraction → bankroll lookup → absolute resolution → validation → bet or rejection

---

## Files Changed

| File | Change |
|------|--------|
| `src/domain/services/bankroll.ts` | **New** — bankroll provider service |
| `src/domain/services/betting.ts` | Remove `clampStake` (moved to pipeline), keep exposure check |
| `src/domain/contracts/prediction.ts` | `stake` schema: `z.number().min(0).max(1)` |
| `src/competitors/weight-tuned/engine.ts` | Output stake as fraction, remove absolute calculation |
| `src/competitors/weight-tuned/types.ts` | Remove `bankroll` from `StakeConfig`, rename `minBet` → `minBetPct` |
| `src/competitors/weight-tuned/stake-validator.ts` | Add bankroll-pct check, min-bankroll check |
| `src/orchestrator/config.ts` | Add `maxBetPctOfBankroll`, `initialBankroll` to `BettingConfig` |
| `src/orchestrator/prediction-pipeline.ts` | Fetch bankroll, resolve fraction → dollars, call validator |
| `src/competitors/loader.ts` | Pass updated `StakeConfig` (no `bankroll` field) |
| Tests (multiple) | Update for new stake semantics |

## Migration Notes

- Existing predictions in the DB have absolute `stake` values. No migration needed — they remain valid as historical records. New predictions will also store absolute resolved amounts.
- The `initialBankroll` config replaces the hardcoded `bankroll: 100` in `DEFAULT_STAKE_CONFIG`. Functionally identical at launch, but now it lives in the pipeline config where it belongs and gets adjusted by actual P&L via the bankroll provider.

## Edge Cases

- **Bankroll is $0 or negative**: Reject all bets with "bankroll depleted" message. The competitor effectively sits out until manually topped up or profits settle.
- **Settled profit exceeds initial bankroll**: Bankroll grows organically — the competitor can bet more as they win.
- **Multiple pending bets**: The bankroll provider subtracts pending exposure, so concurrent bets against the same bankroll are handled correctly.
- **Race condition**: Two prediction runs could overlap and both see the same bankroll. The existing `maxTotalExposure` check in the betting service acts as a safety net here.
