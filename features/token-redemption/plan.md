# Plan: Redeem Winning Conditional Tokens to USDC

**Date:** 2026-03-14
**Status:** Draft

---

## Overview

After a bet settles as won, the competitor's wallet still holds conditional tokens (CTF ERC-1155 tokens) instead of USDC. The settlement service marks bets as `settled_won` in the database but never redeems the tokens on-chain. This means wallet balances shown in the UI don't reflect winnings. A new redemption pipeline will periodically find unredeemed winning bets, call the CTF contract's `redeemPositions()` to convert tokens back to USDC.e, and record the transaction hash.

---

## Approach

Add a **separate redemption pipeline** that runs every 30 minutes via the scheduler, independent of settlement. Settlement remains a pure DB operation (mark bets won/lost); redemption handles the on-chain transaction.

The pipeline:
1. Queries all `settled_won` bets where `redeemedAt IS NULL`.
2. Groups them by `competitorId` (one wallet = one signer = one transaction batch).
3. For each competitor with unredeemed bets, looks up the `conditionId` from the markets table (bulk fetch, no N+1).
4. Creates an ethers.js signer from the competitor's wallet private key.
5. Calls `redeemPositions()` on the CTF contract for each unique conditionId. The CTF `redeemPositions` method takes a collateral token, parentCollectionId (bytes32 zero for top-level), a conditionId, and indexSets. For a binary market: indexSet `[1]` redeems YES tokens, `[2]` redeems NO tokens, `[1,2]` redeems both. We pass the winning side's indexSet.
6. On success, updates the bet rows with `redeemedAt` timestamp and `redemptionTxHash`.
7. Records an audit log entry for each redemption.

**Why separate from settlement:** Settlement is fast (DB-only, ~seconds). On-chain redemption can fail (RPC errors, gas issues, nonce conflicts) and takes 2-5 seconds per transaction. Coupling them would slow settlement and make it fragile. A separate pipeline means settlement failures don't block redemption and vice versa.

**Why 30 minutes:** Settlement runs every 2 hours. Most redemption runs will be no-ops. Gas on Polygon is ~$0.001/tx, so running frequently has no meaningful cost. 30 minutes ensures balances update within half an hour of settlement.

**Neg-risk handling:** Polymarket sports markets use the NegRiskAdapter. For neg-risk markets, tokens are wrapped — redemption must go through the NegRiskAdapter contract (`redeemPositions`) rather than the CTF directly. We detect neg-risk by checking `getNegRisk(tokenId)` on the CLOB client (already exposed in our betting client). We'll cache this per-market to avoid repeated calls.

### Trade-offs

- **One on-chain TX per conditionId per wallet** — not batched across conditions. The CTF contract's `redeemPositions` redeems one condition at a time. Could batch with a multicall contract, but that's unnecessary complexity for the volume we have.
- **Requires POL/MATIC for gas** — wallets need a small balance (~0.01 POL) for redemption transactions. This is already a requirement for placing bets, so no new constraint.
- **RPC reliability** — public Polygon RPCs can be flaky. We use a single RPC endpoint and let failures retry on the next 30-minute cycle. No retry within a single run to keep it simple.
- **No redemption for `settled_lost` bets** — losing tokens are worthless (price = 0), so nothing to redeem.

---

## Changes Required

### `src/database/schema.ts`

Add two columns to the `bets` table:

```typescript
// In the bets table definition, add:
redeemedAt: integer("redeemed_at", { mode: "timestamp" }),
redemptionTxHash: text("redemption_tx_hash"),
```

### `drizzle/0004_token_redemption.sql` (new migration)

```sql
ALTER TABLE `bets` ADD COLUMN `redeemed_at` integer;
--> statement-breakpoint
ALTER TABLE `bets` ADD COLUMN `redemption_tx_hash` text;
```

### `src/database/repositories/bets.ts`

Add two methods:

```typescript
async findUnredeemedWins(): Promise<BetRow[]> {
  return db
    .select()
    .from(bets)
    .where(and(eq(bets.status, "settled_won"), isNull(bets.redeemedAt)))
    .all();
},

async markRedeemed(id: string, txHash: string, redeemedAt: Date): Promise<void> {
  await db
    .update(bets)
    .set({ redemptionTxHash: txHash, redeemedAt })
    .where(eq(bets.id, id))
    .run();
},
```

### `src/apis/polymarket/redemption-client.ts` (new)

Handles on-chain CTF token redemption. Uses ethers.js with the same pattern as `setup-polymarket-wallet.ts`.

```typescript
import { Contract } from "@ethersproject/contracts";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import { logger } from "../../shared/logger.ts";

const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";
const POLYGON_CHAIN_ID = 137;

const CONTRACTS = {
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
  negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  collateral: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
};

const CTF_REDEEM_ABI = [
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
];

const NEG_RISK_ADAPTER_REDEEM_ABI = [
  "function redeemPositions(bytes32 conditionId, uint256[] indexSets, uint256 amount)",
];

export type RedemptionResult = {
  txHash: string;
  conditionId: string;
};

export function createRedemptionClient(privateKey: string) {
  const provider = new JsonRpcProvider(POLYGON_RPC, {
    chainId: POLYGON_CHAIN_ID,
    name: "matic",
  });
  const signer = new Wallet(privateKey, provider);

  return {
    async redeemPositions(params: {
      conditionId: string;
      winningSide: "YES" | "NO";
      negRisk: boolean;
      amount: bigint;
    }): Promise<RedemptionResult> {
      // indexSet: 1 = first outcome (YES), 2 = second outcome (NO)
      const indexSet = params.winningSide === "YES" ? 1 : 2;

      let tx: { hash: string; wait: () => Promise<unknown> };

      if (params.negRisk) {
        const adapter = new Contract(
          CONTRACTS.negRiskAdapter,
          NEG_RISK_ADAPTER_REDEEM_ABI,
          signer,
        );
        tx = await adapter.redeemPositions(
          params.conditionId,
          [indexSet],
          params.amount,
        );
      } else {
        const ctf = new Contract(
          CONTRACTS.conditionalTokens,
          CTF_REDEEM_ABI,
          signer,
        );
        const parentCollectionId = "0x" + "0".repeat(64);
        tx = await ctf.redeemPositions(
          CONTRACTS.collateral,
          parentCollectionId,
          params.conditionId,
          [indexSet],
        );
      }

      await tx.wait();
      return { txHash: tx.hash, conditionId: params.conditionId };
    },
  };
}

export type RedemptionClient = ReturnType<typeof createRedemptionClient>;
```

### `src/orchestrator/redemption-pipeline.ts` (new)

The pipeline that orchestrates redemption runs.

```typescript
import type { BettingClientFactory } from "../apis/polymarket/betting-client-factory.ts";
import { createRedemptionClient } from "../apis/polymarket/redemption-client.ts";
import type { AuditLogRepo } from "../database/repositories/audit-log.ts";
import type { betsRepo as betsRepoFactory } from "../database/repositories/bets.ts";
import type { marketsRepo as marketsRepoFactory } from "../database/repositories/markets.ts";
import type { WalletConfig } from "../domain/types/competitor.ts";
import { logger } from "../shared/logger.ts";

export type RedemptionPipelineDeps = {
  betsRepo: ReturnType<typeof betsRepoFactory>;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
  bettingClientFactory: BettingClientFactory;
  auditLog: AuditLogRepo;
  walletConfigs: Map<string, WalletConfig>;
};

export type RedemptionPipelineResult = {
  redeemed: number;
  skipped: number;
  errors: string[];
};

export function createRedemptionPipeline(deps: RedemptionPipelineDeps) {
  const { betsRepo, marketsRepo, bettingClientFactory, auditLog, walletConfigs } = deps;

  return {
    async run(): Promise<RedemptionPipelineResult> {
      const result: RedemptionPipelineResult = { redeemed: 0, skipped: 0, errors: [] };

      // Step 1: Find all unredeemed winning bets
      const unredeemedBets = await betsRepo.findUnredeemedWins();
      if (unredeemedBets.length === 0) return result;

      // Step 2: Bulk-fetch all referenced markets (avoid N+1)
      const marketIds = [...new Set(unredeemedBets.map((b) => b.marketId))];
      const marketList = await marketsRepo.findByIds(marketIds);
      const marketById = new Map(marketList.map((m) => [m.id, m]));

      // Step 3: Check neg-risk per market (via betting client, cached)
      const negRiskCache = new Map<string, boolean>();

      // Step 4: Group bets by competitorId
      const betsByCompetitor = new Map<string, typeof unredeemedBets>();
      for (const bet of unredeemedBets) {
        const existing = betsByCompetitor.get(bet.competitorId) ?? [];
        existing.push(bet);
        betsByCompetitor.set(bet.competitorId, existing);
      }

      // Step 5: Process each competitor's bets
      for (const [competitorId, competitorBets] of betsByCompetitor) {
        const walletConfig = walletConfigs.get(competitorId);
        if (!walletConfig) {
          result.skipped += competitorBets.length;
          continue;
        }

        const redemptionClient = createRedemptionClient(walletConfig.polyPrivateKey);
        const bettingClient = bettingClientFactory.getClient(competitorId, walletConfig);

        // Group by conditionId to redeem once per condition
        const betsByCondition = new Map<string, typeof competitorBets>();
        for (const bet of competitorBets) {
          const market = marketById.get(bet.marketId);
          if (!market) {
            result.errors.push(`Market ${bet.marketId} not found for bet ${bet.id}`);
            continue;
          }
          const existing = betsByCondition.get(market.conditionId) ?? [];
          existing.push(bet);
          betsByCondition.set(market.conditionId, existing);
        }

        for (const [conditionId, conditionBets] of betsByCondition) {
          try {
            // Check neg-risk (cached)
            const firstBet = conditionBets[0]!;
            let negRisk = negRiskCache.get(firstBet.tokenId);
            if (negRisk === undefined) {
              negRisk = await bettingClient.getNegRisk(firstBet.tokenId);
              negRiskCache.set(firstBet.tokenId, negRisk);
            }

            // Calculate total shares as bigint (CTF uses raw token amounts)
            const totalShares = conditionBets.reduce((sum, b) => sum + b.shares, 0);
            // shares are in USDC-denominated units, CTF uses 1e6 decimals
            const amount = BigInt(Math.floor(totalShares * 1e6));

            const redemptionResult = await redemptionClient.redeemPositions({
              conditionId,
              winningSide: firstBet.side as "YES" | "NO",
              negRisk,
              amount,
            });

            // Mark all bets for this condition as redeemed
            const now = new Date();
            for (const bet of conditionBets) {
              await betsRepo.markRedeemed(bet.id, redemptionResult.txHash, now);
              await auditLog.safeRecord({
                betId: bet.id,
                event: "bet_redeemed",
                statusBefore: "settled_won",
                statusAfter: "settled_won",
                metadata: {
                  txHash: redemptionResult.txHash,
                  conditionId,
                  negRisk,
                },
              });
            }

            result.redeemed += conditionBets.length;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push(`Redemption failed for condition ${conditionId} (${competitorId}): ${msg}`);
          }
        }
      }

      return result;
    },
  };
}

export type RedemptionPipeline = ReturnType<typeof createRedemptionPipeline>;
```

### `src/orchestrator/config.ts`

Add redemption interval to `PipelineConfig`:

```typescript
// Add to PipelineConfig type:
redemptionIntervalMs: number;
redemptionDelayMs?: number;

// Add to DEFAULT_CONFIG:
redemptionIntervalMs: 30 * 60 * 1000, // 30 minutes
```

### `src/orchestrator/scheduler.ts`

Add redemption pipeline to the scheduler, following the exact same pattern as other pipelines:

- Add `redemptionPipeline?: RedemptionPipeline` to `SchedulerDeps`.
- Add `redemptionTimer`, `redemptionDelayTimer`, `redemptionRunning` variables.
- Add `runRedemption()` function with overlap prevention and logging.
- Wire up in `start()` with interval and optional delay.
- Clean up in `stop()`.

### `src/index.ts`

Wire the redemption pipeline into the application:

```typescript
import { createRedemptionPipeline } from "./orchestrator/redemption-pipeline.ts";

const redemptionPipeline = createRedemptionPipeline({
  betsRepo: bets,
  marketsRepo: markets,
  bettingClientFactory,
  auditLog,
  walletConfigs,
});

// Add to scheduler deps:
const scheduler = createScheduler({
  // ...existing deps...
  redemptionPipeline,
  config: pipelineConfig,
});
```

### `src/database/repositories/markets.ts`

Verify `findByIds` exists. If not, add:

```typescript
async findByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(markets).where(inArray(markets.id, ids)).all();
},
```

---

## Data & Migration

- **Migration `0004_token_redemption.sql`**: Two `ALTER TABLE` statements adding nullable columns to `bets`. No data backfill needed — existing `settled_won` bets will have `redeemed_at = NULL`, which means the pipeline will attempt to redeem them on its first run.
- **Drizzle journal**: Add entry `idx: 4`, tag `"0004_token_redemption"`.
- **Existing `settled_won` bets**: The pipeline will pick these up automatically. If the tokens have already been redeemed manually or the market condition is no longer redeemable, the on-chain call will either be a no-op (zero tokens to redeem) or revert — both handled gracefully as errors that will be retried next cycle.

---

## Test Plan

1. **`tests/unit/database/repositories/bets.test.ts`** (update existing):
   - `findUnredeemedWins` returns only `settled_won` bets where `redeemedAt` is null
   - `findUnredeemedWins` excludes `settled_lost`, `pending`, `filled` bets
   - `findUnredeemedWins` excludes already-redeemed `settled_won` bets
   - `markRedeemed` sets `redemptionTxHash` and `redeemedAt`

2. **`tests/unit/orchestrator/redemption-pipeline.test.ts`** (new):
   - No-op when no unredeemed bets exist
   - Redeems winning bets grouped by competitor and condition
   - Skips competitors without wallet config
   - Records audit log entry for each redeemed bet
   - Handles redemption failure gracefully (error captured, other bets still processed)
   - Does not N+1 — markets fetched in bulk

3. **`tests/unit/apis/polymarket/redemption-client.test.ts`** (new):
   - Calls CTF contract for non-neg-risk markets with correct parameters
   - Calls NegRiskAdapter for neg-risk markets with correct parameters
   - Returns txHash on success
   - Propagates contract call errors

---

## Task Breakdown

- [x] Add `redeemedAt` and `redemptionTxHash` columns to bets table in `src/database/schema.ts`
- [x] Create migration `drizzle/0004_token_redemption.sql` with ALTER TABLE statements
- [x] Update `drizzle/meta/_journal.json` with migration entry idx 4
- [x] Add `findUnredeemedWins` and `markRedeemed` methods to `src/database/repositories/bets.ts`
- [x] Verify `findByIds` exists in `src/database/repositories/markets.ts`, add if missing
- [x] Create `src/apis/polymarket/redemption-client.ts` with `createRedemptionClient`
- [x] Create `src/orchestrator/redemption-pipeline.ts` with `createRedemptionPipeline`
- [x] Add `redemptionIntervalMs` and `redemptionDelayMs` to `PipelineConfig` in `src/orchestrator/config.ts`
- [x] Add redemption pipeline to `src/orchestrator/scheduler.ts` (deps, timer, run function, start/stop)
- [x] Wire redemption pipeline in `src/index.ts`
- [x] Update `tests/unit/database/repositories/bets.test.ts` with `findUnredeemedWins` and `markRedeemed` tests
- [x] Create `tests/unit/orchestrator/redemption-pipeline.test.ts`
- [x] Create `tests/unit/apis/polymarket/redemption-client.test.ts`
- [x] Run `bun run typecheck`, `bun run lint`, `bun run test` — fix any failures
