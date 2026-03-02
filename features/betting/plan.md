# Feature 8: Betting (Polymarket Write) — Plan

## Goal

Place real bets on Polymarket based on prediction engine outputs. Includes an authenticated CLOB client, a betting service with budget guards and dry-run mode, and bet recording to the database.

---

## Files to Create

### 1. `src/infrastructure/polymarket/betting-client.ts`

Authenticated CLOB client wrapper for placing orders.

**Exports:**

- `createBettingClient(config)` — factory function returning a `BettingClient`
- `BettingClient` type

**Config shape:**

```typescript
type BettingClientConfig = {
  privateKey: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
};
```

**Internal setup:**

```typescript
import { Wallet } from "@ethersproject/wallet";
import { ClobClient } from "@polymarket/clob-client";

const signer = new Wallet(config.privateKey);
const creds = { key: config.apiKey, secret: config.apiSecret, passphrase: config.apiPassphrase };
const clob = new ClobClient(
  "https://clob.polymarket.com",
  137,           // Polygon
  signer,
  creds,
  0,             // SignatureType.EOA
);
```

**Methods:**

```typescript
type OrderResult = {
  orderId: string;
  // raw response fields as needed
};

type BettingClient = {
  placeOrder(params: {
    tokenId: string;
    price: number;
    amount: number;  // dollar amount
    side: "BUY" | "SELL";
  }): Promise<OrderResult>;

  cancelOrder(orderId: string): Promise<void>;
  cancelAll(): Promise<void>;

  getOpenOrders(): Promise<unknown[]>;
  getTickSize(tokenId: string): Promise<string>;
  getNegRisk(tokenId: string): Promise<boolean>;
};
```

**`placeOrder` implementation detail:**

```typescript
async placeOrder({ tokenId, price, amount, side }) {
  const tickSize = await clob.getTickSize(tokenId);
  const negRisk = await clob.getNegRisk(tokenId);
  const size = amount / price;  // shares = dollars / price_per_share

  const response = await clob.createAndPostOrder(
    { tokenID: tokenId, price, size, side: side === "BUY" ? Side.BUY : Side.SELL },
    { tickSize, negRisk },
    OrderType.GTC,
  );

  return { orderId: response.orderID ?? response.id ?? String(response) };
}
```

**Trade-off: GTC limit vs FOK market orders.** GTC limit orders let us specify a max price and sit on the book if not immediately filled. FOK market orders fill immediately or fail. Starting with GTC is safer — we get price protection. If the order doesn't fill, settlement (Feature 9) will handle stale orders.

---

### 2. `src/domain/services/betting.ts`

Core betting service — pure business logic that orchestrates prediction → bet placement.

**Exports:**

```typescript
type BettingConfig = {
  maxStakePerBet: number;     // e.g., 10 (dollars)
  maxTotalExposure: number;   // e.g., 100 (dollars)
  dryRun: boolean;            // if true, log but don't place
};

type PlaceBetInput = {
  prediction: PredictionOutput;
  market: Market;
  fixtureId: number;
  competitorId: string;
};

type PlaceBetResult = {
  status: "placed" | "dry_run" | "skipped";
  bet?: Bet;
  reason?: string;  // why skipped
};

function resolveTokenId(market: Market, side: "YES" | "NO"): string;
function clampStake(stake: number, maxStake: number): number;

function createBettingService(deps: {
  bettingClient: BettingClient;
  betsRepo: ReturnType<typeof betsRepo>;
  marketsRepo: ReturnType<typeof marketsRepo>;
  config: BettingConfig;
}): BettingService;

type BettingService = {
  placeBet(input: PlaceBetInput): Promise<PlaceBetResult>;
};
```

**`placeBet` flow:**

```
1. Validate: market.acceptingOrders === true
   → skip if not accepting

2. Check dedup: query betsRepo for existing bet on same market+competitor
   with status "pending" or "filled"
   → skip if already bet

3. Clamp stake: min(prediction.stake, config.maxStakePerBet), floor at market minimum

4. Budget guard: sum all pending/filled bets amounts
   → skip if (currentExposure + clampedStake) > config.maxTotalExposure

5. Resolve tokenId: side === "YES" → market.tokenIds[0], "NO" → market.tokenIds[1]

6. Get price: use market.outcomePrices for the chosen side
   (outcomePrices[0] for YES, outcomePrices[1] for NO)

7. If dry-run:
   → log the would-be bet, return { status: "dry_run" }

8. Place order via bettingClient.placeOrder({
     tokenId, price, amount: clampedStake, side: "BUY"
   })

9. Calculate shares = clampedStake / price

10. Generate bet ID (crypto.randomUUID())

11. Record bet via betsRepo.create({
      id, orderId, marketId, fixtureId, competitorId,
      tokenId, side, amount: clampedStake, price, shares,
      status: "pending"
    })

12. Return { status: "placed", bet }
```

**Helper: `resolveTokenId`**

```typescript
export function resolveTokenId(market: Market, side: "YES" | "NO"): string {
  return side === "YES" ? market.tokenIds[0] : market.tokenIds[1];
}
```

**Helper: `clampStake`**

```typescript
export function clampStake(stake: number, maxStake: number): number {
  return Math.max(0.01, Math.min(stake, maxStake));  // at least 1 cent
}
```

**Trade-off: price source.** Using `market.outcomePrices` from the stored market data is simpler (no extra API call) but may be stale. Using CLOB `getMidpoint()` is more accurate but adds latency. Decision: use `outcomePrices` for now. The GTC order provides price protection — if the price moved significantly, the order just won't fill immediately. Feature 10 (pipeline) can refresh market data before betting.

---

### 3. `tests/unit/domain/services/betting.test.ts`

**Helper functions:**
- `makeMarket(overrides?)` — creates a valid `Market` with tokenIds, acceptingOrders, etc.
- `makePrediction(overrides?)` — creates a valid `PredictionOutput`
- `makeBettingConfig(overrides?)` — creates a `BettingConfig` with sensible defaults
- `mockBettingClient()` — returns a mock `BettingClient` with jest-style tracking
- `mockBetsRepo()` — returns a mock repo

**Test cases:**

Helpers:
- `resolveTokenId` returns `tokenIds[0]` for YES
- `resolveTokenId` returns `tokenIds[1]` for NO
- `clampStake` clamps to max
- `clampStake` preserves stake within range
- `clampStake` enforces minimum 0.01

Service — happy path:
- Places bet and returns `{ status: "placed", bet }` with correct fields
- Calls `bettingClient.placeOrder` with correct tokenId, price, amount
- Records bet in `betsRepo.create`
- Generated bet has correct side, amount, marketId, competitorId, etc.

Service — dry run:
- Returns `{ status: "dry_run" }` when `config.dryRun` is true
- Does NOT call `bettingClient.placeOrder`
- Does NOT call `betsRepo.create`

Service — skip conditions:
- Skips when `market.acceptingOrders` is false
- Skips when duplicate bet exists (same market + competitor, pending/filled)
- Skips when budget would be exceeded
- Each skip returns `{ status: "skipped", reason: "..." }`

Service — stake clamping:
- Clamps stake to `config.maxStakePerBet`
- Uses clamped value for order and DB record

Service — error handling:
- Propagates errors from `bettingClient.placeOrder` (doesn't swallow)

---

### 4. `tests/unit/infrastructure/polymarket/betting-client.test.ts`

**Test cases:**

- `createBettingClient` returns object with expected methods
- `placeOrder` calls through to CLOB client with correct params
- `placeOrder` calculates size as amount/price
- `placeOrder` fetches tick size and neg risk before placing
- `cancelOrder` delegates to CLOB
- `getOpenOrders` delegates to CLOB

These tests will mock the `ClobClient` constructor and its methods since we can't call the real CLOB API in tests.

---

## Files to Modify

None. All existing files are reused as-is:
- `src/shared/env.ts` — already has all four `POLY_*` vars
- `src/infrastructure/database/schema.ts` — `bets` table already exists
- `src/infrastructure/database/repositories/bets.ts` — `create`, `findByCompetitor`, `findByStatus` already exist
- `src/infrastructure/database/repositories/markets.ts` — `findById` already exists
- `src/domain/models/prediction.ts` — `Bet`, `BetStatus` types already defined
- `src/domain/models/market.ts` — `Market` type already defined

---

## Dependencies

No new packages. Everything needed is already installed:
- `@polymarket/clob-client` ^5.2.4
- `@ethersproject/wallet` (v5 compat, installed)
- `ethers` v6.16.0 (project-level, but we use `@ethersproject/wallet` for CLOB compat)

---

## Key Design Decisions

1. **GTC limit orders** over FOK market orders — price protection, simpler error handling.
2. **`outcomePrices` as price source** — avoids extra CLOB API calls, GTC order handles staleness.
3. **Budget guard queries DB** — sums pending+filled bets. Simple, accurate, no in-memory state.
4. **Dry-run is config-level** — not per-bet. Entire service either places or logs.
5. **Bet deduplication** — one bet per market+competitor. Prevents double-betting on the same outcome.
6. **`BettingClient` is a thin wrapper** — minimal logic, just adapts the SDK. Business logic lives in `betting.ts`.
7. **Side is always BUY** — we're buying outcome shares (YES or NO tokens). We never sell.

---

## Verification

- [ ] `bun test` — all tests pass
- [ ] `bun run typecheck` — clean
- [ ] `bun run lint:fix` — clean
