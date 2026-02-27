# Feature 9: Settlement & Scoring — Research

## What Feature 9 Does

Poll Polymarket for resolved markets, match them to placed bets, determine winners/losers, calculate profit/loss, update bet statuses in the database, and provide per-competitor performance stats.

---

## What Already Exists

### Bet Lifecycle (DB + Domain)

**`bets` table** — fully supports settlement tracking:
- `status`: enum `"pending" | "filled" | "settled_won" | "settled_lost" | "cancelled"`
- `settledAt`: nullable timestamp — set when bet resolves
- `profit`: nullable real — calculated P&L on settlement
- `shares`: real — outcome tokens bought (`amount / price`)
- `side`: `"YES" | "NO"` — which outcome was bet on
- `tokenId`: the CLOB token ID for the outcome

**`betsRepo`** — all needed methods exist:
- `findByStatus(status)` — find all pending/filled bets
- `updateStatus(id, status, settledAt?, profit?)` — update bet with settlement data
- `getPerformanceStats(competitorId)` — computes wins, losses, totalStaked, totalReturned, accuracy, ROI
- `findByCompetitor(competitorId)` — all bets for a competitor

**`Bet` domain type** (`src/domain/models/prediction.ts`):
```
id, orderId, marketId, fixtureId, competitorId, tokenId,
side, amount, price, shares, status, placedAt, settledAt, profit
```

**`BetStatus`**: `"pending" | "filled" | "settled_won" | "settled_lost" | "cancelled"`

### Market Resolution Data

**`markets` table** — has `closed` (boolean), `active` (boolean), `acceptingOrders` (boolean). Currently no field for the winning outcome.

**`marketsRepo`** — `findById`, `findActive`, `upsert` (updates closed/active/acceptingOrders on conflict).

**`Market` domain type** — `closed: boolean`, `active: boolean`, `outcomes: [string, string]`, `outcomePrices: [string, string]`, `tokenIds: [string, string]`.

### Gamma API — Resolution Fields

**`GammaEvent`** has resolution-relevant fields:
- `closed: boolean` — true when event is resolved
- `score: string` — match score (e.g., "2-1")
- `elapsed: string` — elapsed time
- `period: string` — e.g., "FT" for full time

**`GammaMarket`** has:
- `closed: boolean` — market resolved
- `active: boolean`
- `outcomePrices: string` — JSON string, resolved markets show "1" and "0"

**`GammaEventParams`** supports `closed: true` to fetch only resolved events.

**Gamma client** — `getEvents({ closed: true })` can fetch resolved events.

### CLOB Client — No Native Settlement

The CLOB SDK has **no resolution/settlement/redemption methods**. Resolution must come from the Gamma API.

Useful CLOB methods:
- `getMarket(conditionId)` — returns market data including `closed`, `active` fields (returns `any`)
- `getOpenOrders()` — can check if orders are still open vs filled
- `getTrades()` — execution history

### Fixture Status

**`fixtures` table** — `status` enum includes `"finished"`.
**`fixturesRepo`** — `findByStatus("finished")` to find completed fixtures.

### Performance Stats (already computed)

**`PerformanceStats`** type in `src/domain/models/competitor.ts`:
```
competitorId, totalBets, wins, losses, pending,
totalStaked, totalReturned, profitLoss, accuracy, roi
```

**`betsRepo.getPerformanceStats()`** already computes this by aggregating the `bets` table. Once bets are settled (status updated, profit set), this function automatically reflects correct stats.

### Pricing Client

`getPrice(tokenId, "BUY")` — for a resolved market, the YES token price goes to ~1.0 (if YES won) or ~0.0 (if NO won). This could serve as a fallback resolution signal, but Gamma API `closed` + `outcomePrices` is more reliable.

---

## How Settlement Works on Polymarket

1. A market closes — `closed: true` on the Gamma API
2. The winning outcome's price settles to 1.0, the losing to 0.0
3. `outcomePrices` reflects this: e.g., `["1", "0"]` means outcome[0] (YES) won
4. Token holders of the winning outcome can redeem shares for $1 each
5. Token holders of the losing outcome get $0

**Determining the winner:**
- If `outcomePrices[0]` parses to 1.0 → outcome[0] won (typically YES)
- If `outcomePrices[1]` parses to 1.0 → outcome[1] won (typically NO)

**Profit calculation:**
- If bet won: `profit = shares * 1.0 - amount` (each share pays $1)
  - Simplified: `profit = (amount / price) * 1.0 - amount = amount * (1/price - 1)`
  - Or equivalently: `profit = amount * ((1 - price) / price)`
- If bet lost: `profit = -amount` (shares worth $0)

---

## What Needs Building

### 1. Settlement Service (`src/domain/services/settlement.ts`)

Core logic:
- Fetch resolved markets from Gamma API (query with `closed: true`)
- Match resolved markets to unsettled bets (status "pending" or "filled")
- Determine winning outcome from resolved `outcomePrices`
- For each matched bet: compute profit/loss, update status
- Update market records to reflect `closed: true`

### 2. Gamma Client Extension or Direct Usage

Need to fetch resolved market data. Options:
- **Option A**: Add a method to `gamma-client.ts` like `getMarket(id)` to fetch a single market
- **Option B**: Use `getEvents({ closed: true })` and filter for markets we have bets on
- **Option C**: Add to `pricing-client.ts` using CLOB's `getMarket(conditionId)`

Best approach: use Gamma `getEvents` with `closed: true` to batch-fetch resolved events, then match against our bet records. This avoids N+1 API calls.

### 3. Tests

- Settlement logic: winning YES bet, winning NO bet, losing bet
- Profit calculation accuracy
- Market not yet resolved → skip
- No matching bets → skip
- Already settled bets → skip (idempotency)
- Performance stats after settlement

---

## Key Design Decisions

1. **Resolution source**: Gamma API `outcomePrices` on closed markets — simplest and most reliable
2. **Polling strategy**: query for `closed: true` events, intersect with markets we have bets on
3. **Idempotency**: only settle bets in "pending"/"filled" status, skip already settled
4. **No schema changes needed**: existing `bets` table has all required fields
5. **Performance stats are computed, not stored**: `betsRepo.getPerformanceStats()` derives everything from settled bets — no separate table needed
