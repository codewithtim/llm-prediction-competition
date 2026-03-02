# Feature 9: Settlement & Scoring — Plan

## Goal

Poll Polymarket for resolved markets, match them to placed bets, determine winners/losers, calculate profit/loss, and update bet records in the database. Performance stats are already computed by `betsRepo.getPerformanceStats()` — once bets are settled, scoring works automatically.

---

## Files to Create

### 1. `src/domain/services/settlement.ts`

Core settlement logic — pure business logic that determines outcomes and updates bets.

**Exports:**

```typescript
type SettlementResult = {
  settled: SettledBet[];
  skipped: number;   // bets with no resolved market yet
  errors: string[];  // any errors during processing
};

type SettledBet = {
  betId: string;
  marketId: string;
  competitorId: string;
  side: "YES" | "NO";
  outcome: "won" | "lost";
  profit: number;
};

function determineWinningOutcome(outcomePrices: [string, string]): "YES" | "NO" | null;
function calculateProfit(amount: number, price: number, won: boolean): number;

function createSettlementService(deps: {
  gammaClient: GammaClient;
  betsRepo: ReturnType<typeof betsRepoFactory>;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
}): SettlementService;

type SettlementService = {
  settleBets(): Promise<SettlementResult>;
};
```

**`determineWinningOutcome` logic:**

```typescript
// outcomePrices[0] corresponds to YES, outcomePrices[1] to NO
// Resolved markets have prices at 1.0 and 0.0
function determineWinningOutcome(outcomePrices: [string, string]): "YES" | "NO" | null {
  const yesPrice = parseFloat(outcomePrices[0]);
  const noPrice = parseFloat(outcomePrices[1]);
  if (yesPrice >= 0.99) return "YES";   // YES won (threshold for float precision)
  if (noPrice >= 0.99) return "NO";     // NO won
  return null;                           // not clearly resolved
}
```

**`calculateProfit` logic:**

```typescript
function calculateProfit(amount: number, price: number, won: boolean): number {
  if (won) {
    // Each share pays $1. shares = amount / price.
    // Profit = shares * $1 - amount = amount * (1/price - 1)
    return amount * ((1 - price) / price);
  }
  return -amount;  // lost everything
}
```

**`settleBets` flow:**

```
1. Find all unsettled bets: betsRepo.findByStatus("pending") + betsRepo.findByStatus("filled")

2. Collect unique marketIds from those bets

3. For each unique marketId:
   a. Look up market in DB: marketsRepo.findById(marketId)
   b. If market not found → log error, continue
   c. If market already closed in DB → use stored data
   d. If market not closed → fetch fresh data from Gamma API:
      - gammaClient.getEvents({ closed: true }) is too broad
      - Instead, fetch the specific market via the Gamma events endpoint
      - For simplicity: re-fetch the market by querying Gamma with the event
      - Actually: we can check via the CLOB getMarket(conditionId) which is simpler

   REVISED APPROACH: For each market with unsettled bets:
   a. marketsRepo.findById(marketId) → get stored market with conditionId
   b. Fetch latest market state from Gamma: GET /markets?id={marketId}
   c. If not closed → skip (not resolved yet)
   d. If closed → determine winning outcome from outcomePrices
   e. Update market in DB as closed

4. For each unsettled bet on a resolved market:
   a. Determine if bet won: bet.side === winningOutcome
   b. Calculate profit
   c. Update bet: betsRepo.updateStatus(bet.id, won ? "settled_won" : "settled_lost", new Date(), profit)
   d. Add to settled results

5. Return SettlementResult
```

**Gamma market fetch:** We need a way to fetch a single market by ID. The Gamma API supports `GET /markets?id={marketId}`. We'll add a `getMarketById` method to the Gamma client.

---

### 2. `src/infrastructure/polymarket/gamma-client.ts` (modify)

Add one method to the existing Gamma client:

```typescript
async getMarketById(marketId: string): Promise<GammaMarket | null> {
  const url = `${GAMMA_BASE_URL}/markets?id=${marketId}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gamma API error: ${response.status}`);
  const data = await response.json();
  // Gamma returns an array even for single ID queries
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}
```

This is the minimal addition needed — one method to fetch a specific market's current state (including `closed` and `outcomePrices`).

---

### 3. `tests/unit/domain/services/settlement.test.ts`

**Helper functions:**
- `makeMarketRow(overrides?)` — creates a DB market row
- `makeBetRow(overrides?)` — creates a DB bet row
- `makeGammaMarket(overrides?)` — creates a Gamma API market response
- `mockGammaClient()` — mock with `getMarketById`
- `mockBetsRepo(bets?)` — mock repo
- `mockMarketsRepo(markets?)` — mock repo

**Test cases:**

Helpers:
- `determineWinningOutcome` returns "YES" when outcomePrices is ["1", "0"]
- `determineWinningOutcome` returns "NO" when outcomePrices is ["0", "1"]
- `determineWinningOutcome` returns null for unresolved prices like ["0.6", "0.4"]
- `determineWinningOutcome` handles threshold (["0.99", "0.01"] → "YES")
- `calculateProfit` returns positive profit for winning bet
- `calculateProfit` returns `-amount` for losing bet
- `calculateProfit` math: $5 at price 0.5 won → profit = $5

Service — happy path:
- Settles a winning YES bet correctly (status, profit, settledAt)
- Settles a losing YES bet correctly
- Settles a winning NO bet correctly
- Settles multiple bets on the same resolved market
- Settles bets across different resolved markets
- Calls `betsRepo.updateStatus` with correct args

Service — skip conditions:
- Skips bets whose market is not yet resolved (closed: false)
- Skips bets that are already settled (settled_won/settled_lost)
- Returns skipped count correctly

Service — error handling:
- Handles market not found in DB gracefully
- Handles Gamma API returning null for unknown market
- Continues processing remaining bets after an error

Service — market update:
- Updates market record to closed after resolution detected

---

### 4. `tests/unit/infrastructure/polymarket/gamma-client.test.ts` (modify)

Add tests for the new `getMarketById` method:
- Returns market when found
- Returns null when market not found (empty array)
- Calls correct Gamma URL with market ID

---

## Files to Modify

| File | Change |
|------|--------|
| `src/infrastructure/polymarket/gamma-client.ts` | Add `getMarketById(marketId)` method |
| `tests/unit/infrastructure/polymarket/gamma-client.test.ts` | Add tests for `getMarketById` |

## Files NOT Modified

- `src/infrastructure/database/schema.ts` — no schema changes needed
- `src/infrastructure/database/repositories/bets.ts` — `updateStatus` already exists
- `src/infrastructure/database/repositories/markets.ts` — `upsert` already handles closing
- `src/domain/models/prediction.ts` — `Bet`, `BetStatus` already defined
- `src/domain/models/competitor.ts` — `PerformanceStats` already defined

---

## Dependencies

No new packages.

---

## Key Design Decisions

1. **Per-market fetch from Gamma** — fetch each market individually via `getMarketById` rather than bulk-fetching all closed events. Simpler, and we only have a handful of active bets at any time.
2. **Threshold-based resolution** — use >= 0.99 rather than === 1.0 for float precision safety.
3. **Idempotent** — only processes bets in "pending"/"filled" status. Already-settled bets are ignored.
4. **No separate scoring service** — `betsRepo.getPerformanceStats()` already computes everything from settled bets. No need for a separate scoring module.
5. **Market state synced** — when a market is found to be closed, update it in the DB so future runs skip the Gamma API call.
6. **Error isolation** — errors on one market/bet don't prevent processing others.

---

## Verification

- [ ] `bun test` — all tests pass
- [ ] `bun run typecheck` — clean
- [ ] `bun run lint:fix` — clean
