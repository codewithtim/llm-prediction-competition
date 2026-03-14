# Wallet Setup for a New Competitor

## Prerequisites

- Local `.env` with `WALLET_ENCRYPTION_KEY` and `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` pointing at production
- Your main funding wallet at `data/wallets/tim.json` with POL and USDC
- Competitor record already exists in the database

## Step 1: Add competitor to the database

Run the SQL against production (e.g. via Turso CLI or a script):

```sql
INSERT INTO competitors (id, name, type, model, status, config)
VALUES (
  'mc-poisson',
  'Monte Carlo Poisson',
  'monte-carlo-poisson',
  'statistical',
  'active',
  '{"simulations":10000,"rho":-0.04,"kellyFraction":0.25,"minEdge":0.03,"maxBetPct":0.05,"minBetPct":0.005}'
);
```

For weight-tuned competitors, omit `config` and use `type = 'weight-tuned'` instead.

## Step 2: Create the wallet

```bash
bun run wallets:create mc-poisson
```

This will:

1. Generate a new Polygon wallet (random private key)
2. Register with Polymarket CLOB API to obtain API key, secret, and passphrase
3. Encrypt all credentials with `WALLET_ENCRYPTION_KEY`
4. Store encrypted credentials in the `competitor_wallets` table
5. Write a plaintext backup to `data/wallets/mc-poisson.json`

**Important:** Copy the plaintext credentials to a password manager, then delete the JSON file. Do not commit it.

## Step 3: Fund the wallet

The wallet needs POL (for gas) and USDC.e (for betting). Run the setup script:

```bash
bun run src/scripts/setup-all-wallets.ts
```

This handles three things:

1. **Fund with POL** — sends gas from `data/wallets/tim.json` to the new wallet
2. **Swap USDC → USDC.e** — if the wallet has native USDC, swaps it to USDC.e (bridged) via Uniswap V3. Polymarket only uses USDC.e as collateral
3. **Approve contracts** — approves Polymarket exchange, neg-risk exchange, and neg-risk adapter to spend USDC.e and conditional tokens

If the wallet has no USDC yet, send native USDC to the wallet address first, then re-run the script.

Use `--dry-run` to preview without executing transactions.

## Step 4: Verify

Check that the wallet decrypts correctly:

```bash
bun run src/scripts/verify-wallets.ts
```

Check on-chain balances for all wallets:

```bash
bun run src/scripts/check-all-wallets.ts
```

## Step 5: Redeploy

The running application needs to be restarted to pick up the new competitor:

```bash
gh workflow run deploy.yml -f confirm=deploy
```

After deploy, check the logs for the new competitor loading:

```bash
ssh -i ~/.ssh/llm_betting root@<droplet-ip> "docker logs llm-betting 2>&1 | head -20"
```

You should see `Loaded wallet for competitor` and `Loaded competitor` entries for the new ID.

## Other wallet commands

| Command | Description |
|---------|-------------|
| `bun run wallets:list` | List all competitors and their wallet addresses |
| `bun run wallets:export <id>` | Decrypt and export wallet to `data/wallets/<id>.json` |
| `bun run wallets:import` | Import all JSON files from `data/wallets/` into encrypted DB |
