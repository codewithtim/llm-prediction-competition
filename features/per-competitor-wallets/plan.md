# Per-Competitor Polymarket Wallets

## Context

Currently the system uses a single shared Polymarket wallet (configured via `POLY_*` env vars) for all competitors. All bets are placed from the same wallet regardless of which competitor made the prediction. We need each competitor to have its own wallet so that:
- Each competitor's P&L is financially isolated on-chain
- Competitors can be funded independently
- The competition is fair — one competitor's exposure doesn't block another's

## Current Flow

```
env vars → single createBettingClient() → bettingService → pipeline calls placeBet(competitorId)
```

The `competitorId` is tracked in the database but the actual wallet is always the same.

## Approach

1. **Separate `competitor_wallets` table** — keeps credentials isolated from competitor metadata, easier to audit/rotate
2. **AES-256-GCM encryption at rest** — credentials encrypted before writing to DB, decrypted on load, using a `WALLET_ENCRYPTION_KEY` env var
3. **Betting client factory** — caches per-competitor `BettingClient` instances, resolved at bet placement time
4. **Graceful degradation** — competitors without wallets get `status: "skipped"` on bet placement; dry-run mode works without any wallets

---

## Wallet Lifecycle

### How wallets are generated
Each competitor needs a Polygon wallet (private key + address) and Polymarket API credentials derived from that wallet.

1. **Generate wallet** — `ethers.js` `Wallet.createRandom()` creates a private key + public address
2. **Register with Polymarket** — the `@polymarket/clob-client` SDK's `ClobClient.createApiKey()` signs a message with the private key and registers it with Polymarket, returning `{ apiKey, secret, passphrase }`
3. **Store credentials** — encrypt and save to `competitor_wallets` table; write plaintext to a file in `data/wallets/` (gitignored) for the user to copy to their password manager and then delete
4. **Fund the wallet** — send USDC on Polygon to the wallet address (manual step)

### Management CLI script

**`src/scripts/manage-wallets.ts`** — CLI for wallet operations:

- `bun run wallets:create <competitor-id>` — generates a new wallet, derives Polymarket API keys, encrypts and stores in DB, writes credentials to `data/wallets/<competitor-id>.json`
- `bun run wallets:list` — lists all competitors and their wallet addresses (no secrets)
- `bun run wallets:export <competitor-id>` — decrypts and writes full credentials to `data/wallets/<competitor-id>.json` (for backup/recovery)
- `bun run wallets:remove <competitor-id>` — removes wallet from DB (does not touch on-chain funds)

**`package.json`** — add `wallets:create`, `wallets:list`, `wallets:export`, `wallets:remove` scripts

**`.gitignore`** — add `data/wallets/` to ensure credential files are never committed

### Credential file format

`data/wallets/<competitor-id>.json`:
```json
{
  "competitorId": "baseline",
  "walletAddress": "0x...",
  "privateKey": "0x...",
  "apiKey": "...",
  "apiSecret": "...",
  "apiPassphrase": "..."
}
```

### Backup strategy
On create or export, credentials are written to a local file (gitignored). The user copies them to their password manager and deletes the file. If the `WALLET_ENCRYPTION_KEY` is lost, the DB credentials are unrecoverable — but the password manager backup allows re-importing via a future `wallets:import` command.

---

## Changes

### 1. Add wallet types and encryption utility

**`src/domain/types/competitor.ts`**

Add `WalletConfig` type:
```ts
export type WalletConfig = {
  polyPrivateKey: string;
  polyApiKey: string;
  polyApiSecret: string;
  polyApiPassphrase: string;
};
```

**`src/shared/crypto.ts`** (new file)

Encryption/decryption utility using Node's built-in `crypto` module:
- `encrypt(plaintext: string, key: string): string` — AES-256-GCM, returns `iv:authTag:ciphertext` as a single hex string
- `decrypt(encrypted: string, key: string): string` — reverses the above
- Key derived from `WALLET_ENCRYPTION_KEY` env var via SHA-256 hash (to ensure 32-byte key)

### 2. Add `competitor_wallets` table

**`src/infrastructure/database/schema.ts`**

New table:
```ts
export const competitorWallets = sqliteTable("competitor_wallets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  competitorId: text("competitor_id").notNull().unique().references(() => competitors.id),
  walletAddress: text("wallet_address").notNull(),
  encryptedPrivateKey: text("encrypted_private_key").notNull(),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  encryptedApiSecret: text("encrypted_api_secret").notNull(),
  encryptedApiPassphrase: text("encrypted_api_passphrase").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

**`drizzle/` migration** — generate via `bun run db:generate`

### 3. Add wallets repository

**`src/infrastructure/database/repositories/wallets.ts`** (new file)

- `findByCompetitorId(competitorId)` — returns encrypted row or null
- `create(competitorId, walletConfig, encryptionKey)` — encrypts and stores credentials
- `delete(competitorId)` — removes wallet for a competitor

### 4. Add `WALLET_ENCRYPTION_KEY` env var

**`src/shared/env.ts`**

Add optional `WALLET_ENCRYPTION_KEY` field (defaults to `""`). When empty, wallet loading is skipped gracefully.

### 5. Create a betting client factory

**`src/infrastructure/polymarket/betting-client-factory.ts`** (new file)

- `createBettingClientFactory()` returns `{ getClient(competitorId, walletConfig): BettingClient }`
- Caches `BettingClient` instances by `competitorId` (avoids recreating `ClobClient` + `Wallet` signer on every bet)
- Internally calls the existing `createBettingClient()` from `betting-client.ts`

### 6. Extend RegisteredEngine with wallet config

**`src/engine/types.ts`**

Add optional `walletConfig` to `RegisteredEngine`:
```ts
export type RegisteredEngine = {
  competitorId: string;
  name: string;
  engine: PredictionEngine;
  walletConfig?: WalletConfig;
};
```

### 7. Load and decrypt wallet config during competitor loading

**`src/competitors/loader.ts`**

- Accept `walletsRepo` and `encryptionKey` in `LoaderDeps`
- After loading each competitor, query `competitor_wallets` for their credentials
- Decrypt and attach as `walletConfig` on `RegisteredEngine`
- Competitors without a wallet row get `walletConfig: undefined`

### 8. Update the betting service

**`src/domain/services/betting.ts`**

- Change `deps.bettingClient: BettingClient` → `deps.bettingClientFactory: BettingClientFactory`
- Add `walletConfig?: WalletConfig` to `PlaceBetInput`
- In `placeBet()`: if `walletConfig` is provided, resolve client via factory; if not and not dry-run, skip with `"No wallet configured for competitor"`
- Keep `dryRun` logic — dry run still doesn't need a real client

### 9. Pass wallet config through the pipeline

**`src/orchestrator/pipeline.ts`** (around line 300)

The pipeline already has access to the `RegisteredEngine` per competitor. Pass `engine.walletConfig` into `bettingService.placeBet()` alongside the existing `competitorId`.

### 10. Update wiring in index.ts

**`src/index.ts`**

- Replace `createBettingClient(config)` / `createStubBettingClient()` with `createBettingClientFactory()`
- Create `walletsRepo` and pass to competitor loader
- Pass factory to `createBettingService` instead of a single client
- Remove the `polyConfigured` check and the single-wallet env var logic

### 11. Update tests

- **`tests/unit/shared/crypto.test.ts`** (new) — encrypt/decrypt round-trip, wrong key fails, different plaintexts produce different ciphertexts
- **`tests/unit/domain/services/betting.test.ts`** — mock factory instead of single client; test skipping when no wallet config
- **`tests/unit/orchestrator/pipeline.test.ts`** — add `walletConfig` to mock engines, update `bettingService` mock

---

## Files Touched

| File | Action |
|------|--------|
| `src/domain/types/competitor.ts` | Edit — add `WalletConfig` type |
| `src/shared/crypto.ts` | New — AES-256-GCM encrypt/decrypt |
| `src/shared/env.ts` | Edit — add `WALLET_ENCRYPTION_KEY` |
| `src/infrastructure/database/schema.ts` | Edit — add `competitorWallets` table |
| `src/infrastructure/database/repositories/wallets.ts` | New — wallet CRUD with encryption |
| `src/infrastructure/polymarket/betting-client-factory.ts` | New — cached client factory |
| `src/infrastructure/polymarket/betting-client.ts` | No change (factory uses it internally) |
| `src/domain/services/betting.ts` | Edit — accept factory + wallet config per bet |
| `src/engine/types.ts` | Edit — add `walletConfig` to `RegisteredEngine` |
| `src/competitors/loader.ts` | Edit — load and decrypt wallet from DB |
| `src/orchestrator/pipeline.ts` | Edit — pass wallet config to `placeBet()` |
| `src/index.ts` | Edit — use factory, create wallets repo |
| `tests/unit/shared/crypto.test.ts` | New — encryption tests |
| `tests/unit/domain/services/betting.test.ts` | Edit — factory pattern |
| `tests/unit/orchestrator/pipeline.test.ts` | Edit — update mocks |
| `src/scripts/manage-wallets.ts` | New — wallet generation/management CLI |
| `package.json` | Edit — add `wallets:*` scripts |

## Verification

1. `bun run db:generate` — migration generates cleanly
2. `bun run typecheck` — no type errors
3. `bun test` — all tests pass
4. `bun run lint` — no lint errors
5. Dry-run mode still works when no wallets or encryption key configured
6. Competitors without wallet rows get `status: "skipped"` on bet placement
7. `bun run wallets:create baseline` — generates wallet, prints credentials, stores encrypted in DB
8. `bun run wallets:list` — shows competitors with wallet addresses
