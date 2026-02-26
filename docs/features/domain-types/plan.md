# Plan: Feature 1 — Domain Types & Contracts

Scope: define the core TypeScript types and Zod validation schemas that every other feature depends on. Football only. No database, no API calls, no infrastructure — pure types.

---

## 1. Domain Models

All models live in `src/domain/models/`. Each file exports plain TypeScript types — no classes, no ORM decorators, no framework coupling.

### `src/domain/models/market.ts`

Types representing Polymarket markets and events. Shaped to match the Gamma API but only the fields we actually need.

```typescript
/** A Polymarket event — container for one or more markets */
export type Event = {
  id: string;
  slug: string;
  title: string;
  startDate: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  markets: Market[];
};

/** A single binary YES/NO market on Polymarket */
export type Market = {
  id: string;
  conditionId: string;
  slug: string;
  question: string;
  outcomes: [string, string]; // e.g. ["Yes", "No"]
  outcomePrices: [string, string]; // implied probabilities
  tokenIds: [string, string]; // ERC1155 token IDs [Yes, No]
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  liquidity: number;
  volume: number;
  gameId: string | null; // Polymarket's game ID for sports markets
  sportsMarketType: string | null; // e.g. "moneyline", "spread", "total"
  line: number | null; // spread/total line value
};
```

**Trade-off:** We could import types directly from `@polymarket/clob-client`, but their types are very broad (80+ fields). Defining our own slim types keeps the domain clean — we map API responses to these at the infrastructure boundary.

### `src/domain/models/fixture.ts`

A football match from API-Sports.

```typescript
/** A football match */
export type Fixture = {
  id: number; // API-Sports fixture ID
  league: League;
  homeTeam: Team;
  awayTeam: Team;
  date: string; // ISO 8601
  venue: string | null;
  status: FixtureStatus;
};

export type League = {
  id: number;
  name: string; // e.g. "Premier League"
  country: string;
  season: number;
};

export type Team = {
  id: number;
  name: string;
  logo: string | null;
};

export type FixtureStatus =
  | "scheduled"
  | "in_progress"
  | "finished"
  | "postponed"
  | "cancelled";
```

### `src/domain/models/prediction.ts`

What a competitor's engine outputs, and the bet that gets placed.

```typescript
/** Direction of a prediction */
export type PredictionSide = "YES" | "NO";

/** A competitor's prediction for a single market */
export type Prediction = {
  marketId: string; // Polymarket market ID
  fixtureId: number; // API-Sports fixture ID
  competitorId: string;
  side: PredictionSide;
  confidence: number; // 0-1, how confident the engine is
  stake: number; // suggested USDC amount
  reasoning: string; // short explanation
  createdAt: string; // ISO 8601
};

/** A placed bet on Polymarket */
export type Bet = {
  id: string; // our internal ID (ULID or UUID)
  orderId: string; // Polymarket order ID
  marketId: string;
  fixtureId: number;
  competitorId: string;
  tokenId: string; // which token was bought
  side: PredictionSide;
  amount: number; // USDC spent
  price: number; // price paid (0-1)
  shares: number; // tokens received (amount / price)
  status: BetStatus;
  placedAt: string;
  settledAt: string | null;
  profit: number | null; // null until settled
};

export type BetStatus =
  | "pending" // order submitted, not yet filled
  | "filled" // order filled
  | "settled_won" // market resolved, we won
  | "settled_lost" // market resolved, we lost
  | "cancelled"; // order was cancelled
```

### `src/domain/models/competitor.ts`

An LLM competitor and its performance record.

```typescript
/** An LLM competitor in the competition */
export type Competitor = {
  id: string;
  name: string; // e.g. "Claude", "GPT-4", "Gemini"
  model: string; // OpenRouter model string, e.g. "anthropic/claude-sonnet-4"
  enginePath: string; // path to engine file, e.g. "src/competitors/claude/engine.ts"
  active: boolean;
  createdAt: string;
};

/** Aggregated performance stats for a competitor */
export type PerformanceStats = {
  competitorId: string;
  totalBets: number;
  wins: number;
  losses: number;
  pending: number;
  totalStaked: number; // USDC
  totalReturned: number; // USDC
  profitLoss: number; // totalReturned - totalStaked
  accuracy: number; // wins / (wins + losses), 0-1
  roi: number; // profitLoss / totalStaked, can be negative
};
```

---

## 2. Contracts (Zod Schemas)

Contracts live in `src/domain/contracts/`. These are Zod schemas that validate data at boundaries — API responses coming in, and LLM prediction outputs going out.

### `src/domain/contracts/statistics.ts`

The strongly-typed statistics bundle passed to LLM prediction engines. This is the input contract — what every engine receives.

```typescript
import { z } from "zod";

/** Team season statistics */
export const teamStatsSchema = z.object({
  teamId: z.number(),
  teamName: z.string(),
  played: z.number(),
  wins: z.number(),
  draws: z.number(),
  losses: z.number(),
  goalsFor: z.number(),
  goalsAgainst: z.number(),
  goalDifference: z.number(),
  points: z.number(),
  form: z.string().nullable(), // e.g. "WWDLW" (last 5 games)
  homeRecord: z.object({
    played: z.number(),
    wins: z.number(),
    draws: z.number(),
    losses: z.number(),
    goalsFor: z.number(),
    goalsAgainst: z.number(),
  }),
  awayRecord: z.object({
    played: z.number(),
    wins: z.number(),
    draws: z.number(),
    losses: z.number(),
    goalsFor: z.number(),
    goalsAgainst: z.number(),
  }),
});

/** Head-to-head record between two teams */
export const h2hSchema = z.object({
  totalMatches: z.number(),
  homeWins: z.number(),
  awayWins: z.number(),
  draws: z.number(),
  recentMatches: z.array(z.object({
    date: z.string(),
    homeTeam: z.string(),
    awayTeam: z.string(),
    homeGoals: z.number(),
    awayGoals: z.number(),
  })),
});

/** Market context from Polymarket */
export const marketContextSchema = z.object({
  marketId: z.string(),
  question: z.string(),
  currentYesPrice: z.number(), // 0-1
  currentNoPrice: z.number(), // 0-1
  liquidity: z.number(),
  volume: z.number(),
  sportsMarketType: z.string().nullable(),
  line: z.number().nullable(),
});

/** The full statistics bundle passed to a prediction engine */
export const statisticsSchema = z.object({
  fixtureId: z.number(),
  league: z.object({
    id: z.number(),
    name: z.string(),
    country: z.string(),
    season: z.number(),
  }),
  homeTeam: teamStatsSchema,
  awayTeam: teamStatsSchema,
  h2h: h2hSchema,
  market: marketContextSchema,
});

export type TeamStats = z.infer<typeof teamStatsSchema>;
export type H2H = z.infer<typeof h2hSchema>;
export type MarketContext = z.infer<typeof marketContextSchema>;
export type Statistics = z.infer<typeof statisticsSchema>;
```

**Trade-off:** We could make the stats contract more granular (individual player stats, xG, etc.) but starting simple lets us validate the pipeline end-to-end. Player stats and advanced metrics can be added later without breaking existing engines — just add optional fields.

### `src/domain/contracts/prediction.ts`

The output contract — what LLM prediction engines must return.

```typescript
import { z } from "zod";

/** What a prediction engine must return */
export const predictionOutputSchema = z.object({
  marketId: z.string(),
  side: z.enum(["YES", "NO"]),
  confidence: z.number().min(0).max(1),
  stake: z.number().positive(),
  reasoning: z.string().min(1).max(500),
});

export type PredictionOutput = z.infer<typeof predictionOutputSchema>;
```

### `src/domain/contracts/engine.ts`

The interface that all prediction engines must implement.

```typescript
import type { PredictionOutput } from "./prediction";
import type { Statistics } from "./statistics";

/** The function signature every prediction engine must export */
export type PredictionEngine = (statistics: Statistics) => PredictionOutput | Promise<PredictionOutput>;
```

This is a plain type, not a Zod schema — it's enforced at the TypeScript level.

---

## 3. Tests

### `tests/unit/domain/contracts/statistics.test.ts`

Validate the statistics Zod schema accepts good data and rejects bad data.

```typescript
import { describe, expect, it } from "bun:test";
import { statisticsSchema } from "@domain/contracts/statistics";

describe("statisticsSchema", () => {
  it("accepts valid statistics", () => {
    const valid = {
      fixtureId: 123,
      league: { id: 39, name: "Premier League", country: "England", season: 2025 },
      homeTeam: {
        teamId: 1,
        teamName: "Arsenal",
        played: 20, wins: 14, draws: 3, losses: 3,
        goalsFor: 42, goalsAgainst: 15, goalDifference: 27, points: 45,
        form: "WWDWW",
        homeRecord: { played: 10, wins: 8, draws: 1, losses: 1, goalsFor: 24, goalsAgainst: 6 },
        awayRecord: { played: 10, wins: 6, draws: 2, losses: 2, goalsFor: 18, goalsAgainst: 9 },
      },
      awayTeam: { /* same shape */ },
      h2h: { totalMatches: 5, homeWins: 3, awayWins: 1, draws: 1, recentMatches: [] },
      market: {
        marketId: "abc-123",
        question: "Will Arsenal win?",
        currentYesPrice: 0.65,
        currentNoPrice: 0.35,
        liquidity: 50000,
        volume: 120000,
        sportsMarketType: "moneyline",
        line: null,
      },
    };
    expect(() => statisticsSchema.parse(valid)).not.toThrow();
  });

  it("rejects missing fixtureId", () => {
    const invalid = { league: {}, homeTeam: {}, awayTeam: {}, h2h: {}, market: {} };
    expect(() => statisticsSchema.parse(invalid)).toThrow();
  });
});
```

### `tests/unit/domain/contracts/prediction.test.ts`

```typescript
import { describe, expect, it } from "bun:test";
import { predictionOutputSchema } from "@domain/contracts/prediction";

describe("predictionOutputSchema", () => {
  it("accepts valid prediction", () => {
    const valid = {
      marketId: "abc-123",
      side: "YES",
      confidence: 0.75,
      stake: 5.0,
      reasoning: "Home team has strong form and H2H advantage",
    };
    expect(() => predictionOutputSchema.parse(valid)).not.toThrow();
  });

  it("rejects confidence > 1", () => {
    const invalid = { marketId: "abc", side: "YES", confidence: 1.5, stake: 5, reasoning: "test" };
    expect(() => predictionOutputSchema.parse(invalid)).toThrow();
  });

  it("rejects negative stake", () => {
    const invalid = { marketId: "abc", side: "NO", confidence: 0.5, stake: -1, reasoning: "test" };
    expect(() => predictionOutputSchema.parse(invalid)).toThrow();
  });

  it("rejects empty reasoning", () => {
    const invalid = { marketId: "abc", side: "YES", confidence: 0.5, stake: 5, reasoning: "" };
    expect(() => predictionOutputSchema.parse(invalid)).toThrow();
  });

  it("rejects invalid side", () => {
    const invalid = { marketId: "abc", side: "MAYBE", confidence: 0.5, stake: 5, reasoning: "test" };
    expect(() => predictionOutputSchema.parse(invalid)).toThrow();
  });
});
```

---

## 4. Files to create

| File | Purpose |
|------|---------|
| `src/domain/models/market.ts` | Market, Event types (Polymarket) |
| `src/domain/models/fixture.ts` | Fixture, League, Team, FixtureStatus types (API-Sports football) |
| `src/domain/models/prediction.ts` | Prediction, Bet, BetStatus types |
| `src/domain/models/competitor.ts` | Competitor, PerformanceStats types |
| `src/domain/contracts/statistics.ts` | Statistics input Zod schema + inferred types |
| `src/domain/contracts/prediction.ts` | PredictionOutput Zod schema + inferred type |
| `src/domain/contracts/engine.ts` | PredictionEngine function type |
| `tests/unit/domain/contracts/statistics.test.ts` | Validation tests for statistics schema |
| `tests/unit/domain/contracts/prediction.test.ts` | Validation tests for prediction output schema |

## 5. Files to modify

| File | Change |
|------|--------|
| `src/infrastructure/database/schema.ts` | No change yet — that's Feature 2 |

---

## 6. Design decisions

1. **Slim domain types over SDK re-exports.** We define our own `Market`/`Event` types with only the fields we need (~15 fields), rather than re-exporting Polymarket's types (~80+ fields). Mapping happens at the infrastructure boundary.

2. **Zod schemas only at boundaries.** The `Statistics` and `PredictionOutput` contracts use Zod because they validate external data (API responses and LLM-generated outputs). Internal domain types are plain TypeScript — no runtime validation overhead for trusted internal data.

3. **Football only.** The `Statistics` schema is designed for football: team records, home/away splits, form strings, H2H. No abstraction for multi-sport support.

4. **`PredictionEngine` is a function type, not a class.** Engines are just functions: `(statistics: Statistics) => PredictionOutput`. This is the simplest possible contract — no lifecycle, no state, no constructor. An engine receives data and returns a prediction.

5. **Confidence is 0-1, not a percentage.** Matches Polymarket's price format (also 0-1). No conversion needed.

6. **Reasoning is required.** Every prediction must include a short explanation. This is crucial for the feedback loop — LLMs need to see why they made past decisions.

---

## Todo List

### Phase 1: Domain Models

- [x] 1.1 Create `src/domain/models/market.ts` — `Event` and `Market` types
- [x] 1.2 Create `src/domain/models/fixture.ts` — `Fixture`, `League`, `Team`, `FixtureStatus` types
- [x] 1.3 Create `src/domain/models/prediction.ts` — `PredictionSide`, `Prediction`, `Bet`, `BetStatus` types
- [x] 1.4 Create `src/domain/models/competitor.ts` — `Competitor`, `PerformanceStats` types

### Phase 2: Contracts (Zod Schemas)

- [x] 2.1 Create `src/domain/contracts/statistics.ts` — `teamStatsSchema`, `h2hSchema`, `marketContextSchema`, `statisticsSchema` + inferred types
- [x] 2.2 Create `src/domain/contracts/prediction.ts` — `predictionOutputSchema` + inferred type
- [x] 2.3 Create `src/domain/contracts/engine.ts` — `PredictionEngine` function type

### Phase 3: Tests

- [x] 3.1 Create `tests/unit/domain/contracts/statistics.test.ts` — valid input accepted, missing/invalid fields rejected
- [x] 3.2 Create `tests/unit/domain/contracts/prediction.test.ts` — valid prediction accepted, confidence > 1 rejected, negative stake rejected, empty reasoning rejected, invalid side rejected

### Phase 4: Verification

- [x] 4.1 Run `bun run typecheck` — all types compile cleanly
- [x] 4.2 Run `bun test` — all contract validation tests pass
- [x] 4.3 Run `bun run lint` — no lint errors
