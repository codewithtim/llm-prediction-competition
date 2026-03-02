# Weight-Tuned Prediction Engine (replacing codegen)

## Context

The current `codegen` system asks LLMs to generate entire TypeScript prediction engine files. This is fragile: code generation produces syntax errors, runtime failures, and import issues that require complex validation (temp files, dynamic imports, schema checks). The generated code also tends to be variations of the same weighted-average approach anyway.

The proposal: replace code generation with a **single, fixed, well-tested prediction function** parameterized by a `WeightConfig` JSON object. The LLM's iteration job becomes: read performance data, output new weights as JSON numbers. No code generation, no syntax validation, no disk file management.

## Why this is better than codegen

| Aspect | Codegen | Weight-tuned |
|--------|---------|-------------|
| LLM output | Full TypeScript source | ~16 JSON numbers |
| Validation | Write temp file → import → run → schema check | `zod.safeParse(json)` |
| Failure modes | Syntax errors, import paths, runtime crashes, wrong types | Invalid number range (trivially caught) |
| Iteration speed | Generate + validate + save to disk + dynamic import | Parse JSON + store in DB |
| Interpretability | Read and understand arbitrary code | See which weights changed and by how much |
| Comparability | Apples to oranges (different code) | Diff weight vectors directly |
| Search space | Unbounded (any valid TypeScript) | 16 bounded parameters |

The baseline engine, runtime LLM engine, and existing engine contract (`PredictionEngine` type) are all **unchanged**.

---

## Design

### WeightConfig (hybrid: generic features + fixed params)

The engine core works with a **generic feature/weight map** — it doesn't know or care about feature names. This means adding new features later (injuries, xG, player stats) only requires writing a new extraction function and registering it. The engine, validation, and iteration code stay untouched.

```typescript
type WeightConfig = {
  // Signal weights — generic map of feature name → weight [0,1]
  // Engine multiplies each feature value by its weight, normalizes the sum.
  // Adding a new feature = add an extraction function + a key here.
  signals: Record<string, number>;

  // Probability shaping — maps composite score to 3-outcome distribution
  drawBaseline: number;          // [0.15, 0.35] Base draw probability
  drawPeak: number;              // [0.40, 0.60] Home strength value where draw is most likely
  drawWidth: number;             // [0.05, 0.30] How sharply draw probability falls off

  // Market selection
  minEdge: number;               // [0.01, 0.30] Minimum edge over market price to bet
  liquidityWeight: number;       // [0, 1] Preference for higher-liquidity markets

  // Staking (bankroll-relative)
  stakingAggression: number;     // [0, 1] Base fraction of max allowed bet (0.2 = use 20% of cap by default)
  edgeMultiplier: number;        // [0, 1] How much edge scales stake toward the cap
  confidenceThreshold: number;   // [0.50, 0.90] Below this confidence, use minimum bet
};
```

Default weights (starting set, equivalent to a richer baseline):

```typescript
const DEFAULT_WEIGHTS: WeightConfig = {
  signals: {
    homeWinRate: 0.4,
    awayLossRate: 0.0,
    formDiff: 0.3,
    h2h: 0.3,
    goalDiff: 0.0,
    pointsPerGame: 0.0,
    defensiveStrength: 0.0,
  },
  drawBaseline: 0.25,
  drawPeak: 0.50,
  drawWidth: 0.15,
  minEdge: 0.05,
  liquidityWeight: 0.0,
  stakingAggression: 0.3,
  edgeMultiplier: 0.5,
  confidenceThreshold: 0.55,
};
```

### Feature registry (extensible)

Features are registered as named extraction functions. The engine iterates over all registered features, extracts values, and matches them to the `signals` map in the weight config. Any feature not present in `signals` is ignored (weight 0). Any signal key with no matching extractor is ignored.

```typescript
type FeatureExtractor = (statistics: Statistics) => number; // must return [0, 1]

// Registry — add new features here without touching the engine
const FEATURE_REGISTRY: Record<string, FeatureExtractor> = {
  homeWinRate: (s) => ...,
  awayLossRate: (s) => ...,
  formDiff: (s) => ...,
  // ... future: injuryImpact, xgDiff, etc.
};
```

**To add a new feature later** (e.g., player injuries):
1. Add injury data to the `Statistics` type (pipeline change)
2. Write one extraction function: `injuryImpact: (s) => ...` → [0,1]
3. Register it in `FEATURE_REGISTRY`
4. The LLM will automatically see it as a new tunable weight in the next iteration

No changes to: engine core, validation, iteration, generator, or feedback prompt logic.

### Starting features (all normalized to [0,1])

7 features derived from `Statistics`, each handling edge cases (zero games, null form, no H2H):

1. **homeWinRate** — `homeTeam.homeRecord.wins / homeTeam.homeRecord.played` (default 0.5). Reuses baseline's `computeHomeWinRate`.
2. **awayLossRate** — `awayTeam.awayRecord.losses / awayTeam.awayRecord.played` (default 0.5). New signal: how often the away team loses on the road.
3. **formDiff** — `(parseForm(home) - parseForm(away) + 1) / 2`. Reuses baseline's `parseForm`. Maps [-1,1] → [0,1].
4. **h2h** — `h2h.homeWins / h2h.totalMatches` (default 0.5). Reuses baseline's `computeH2hAdvantage`.
5. **goalDiff** — `clamp((homeGD/played - awayGD/played) / 4 + 0.5, 0, 1)`. New signal.
6. **pointsPerGame** — `clamp((homePPG - awayPPG) / 3 + 0.5, 0, 1)`. New signal.
7. **defensiveStrength** — `clamp((awayGA/played - homeGA/played) / 2 + 0.5, 0, 1)`. New signal. Higher = home concedes less.

### Prediction algorithm

**Step 1: Composite score**

```
homeStrength = normalize(Σ weight_i × feature_i)
```

Weights are divided by their sum, so the result is always [0,1]. If all weights are 0, default to 0.5.

**Step 2: 3-outcome probabilities**

```
drawProb = drawBaseline × exp(-((homeStrength - drawPeak)² / (2 × drawWidth²)))
remaining = 1 - drawProb
pHome = remaining × homeStrength
pAway = remaining × (1 - homeStrength)
```

Gaussian draw curve: draws peak when teams are balanced (homeStrength ≈ drawPeak), fall off when one team dominates.

**Step 3: Market classification**

Each market in `statistics.markets` is classified as "home", "away", or "draw" by checking the `question` text against team names (e.g., "Will Arsenal win?" → home, "Will Chelsea win?" → away, "draw" → draw). All three `sportsMarketType` values are `"moneyline"`, so we must parse the question.

**Step 4: Market selection (pick best value)**

For each classified market:
```
estimatedYes = pHome | pAway | pDraw (depending on market type)
edgeYes = estimatedYes - market.currentYesPrice
edgeNo = (1 - estimatedYes) - market.currentNoPrice
bestEdge = max(edgeYes, edgeNo)
side = edgeYes > edgeNo ? "YES" : "NO"
```

Optionally adjust by liquidity: `adjustedEdge = bestEdge × (1 + liquidityWeight × normLiquidity)`.

Pick the market with highest positive `adjustedEdge`. If all edges are below `minEdge`, still return a prediction (contract requires at least one) but use minimum stake.

**Step 5: Confidence & staking (bankroll-relative)**

Staking is relative to the competitor's current bankroll, capped by a system-wide config (`maxBetPct`, e.g. 5%).

```
maxBet = bankroll × SYSTEM_CONFIG.maxBetPct        // e.g. 1000 × 0.05 = $50
minBet = SYSTEM_CONFIG.minBet                       // e.g. $1 — floor to avoid dust bets

confidence = clamp(0.5 + bestEdge, 0, 1)
stake = maxBet × clamp(stakingAggression + edgeMultiplier × bestEdge, 0, 1)
stake = clamp(stake, minBet, maxBet)
if confidence < confidenceThreshold → stake = minBet
```

`SYSTEM_CONFIG.maxBetPct` is a system-wide constant (not LLM-tunable) — it protects competitors from blowing up regardless of what weights the LLM picks. The LLM controls *how much of that budget to use* via `stakingAggression` (baseline fraction) and `edgeMultiplier` (how much edge scales it up).

**Step 6: Return PredictionOutput** with auto-generated reasoning string showing top features and edge.

### Post-prediction stake validation

After the engine returns its `PredictionOutput`, a **deterministic validation step** checks that the stake respects system constraints before the bet is placed. This runs outside the engine — it's a system-level guard, not something the LLM can influence.

```typescript
type StakeConstraints = {
  maxBetPct: number;   // e.g. 0.05 (5% of bankroll)
  minBet: number;      // e.g. 1 ($1 floor)
};

function validateStake(
  prediction: PredictionOutput,
  bankroll: number,
  constraints: StakeConstraints
): { valid: boolean; reason?: string }
```

Checks:
1. `stake > 0` — no zero/negative bets
2. `stake >= constraints.minBet` — meets minimum
3. `stake <= bankroll × constraints.maxBetPct` — within bankroll cap
4. `stake <= bankroll` — can't bet more than you have

If validation fails, the prediction is **rejected** — it doesn't silently clamp. This matters for the iteration loop: the LLM gets feedback that its weights produced an invalid stake, so it learns to stay within bounds. The validator returns the reason so it can be included in the feedback prompt.

In practice, the engine formula already clamps to `maxBet`, so validation failures should be rare. But the post-prediction check is a safety net — if the engine code has a bug, or weights interact in unexpected ways, we catch it before real money is at risk.

### Factory function

```typescript
function createWeightedEngine(weights: WeightConfig): PredictionEngine
```

Returns a synchronous function satisfying the existing `PredictionEngine` type. No changes needed to the engine runner, validator, or pipeline.

---

## Iteration loop (replaces codegen iteration)

### Current codegen flow
1. Read engine code from disk
2. Build feedback prompt with code + performance data
3. LLM generates new TypeScript code
4. Validate: write temp file → import → run → schema check
5. Save code to disk + DB

### New weight-tuned flow
1. Read current weights from DB (`competitor_versions.code` column, JSON)
2. Build feedback prompt with weights (as JSON table) + performance data
3. LLM generates new weights (JSON structured output via `WEIGHT_JSON_SCHEMA`)
4. Validate: `weightConfigSchema.safeParse()` + test run with `SAMPLE_STATISTICS`
5. Save weights to DB (`competitor_versions.code` column)

The feedback prompt changes from showing 300 lines of TypeScript to a compact JSON block + a table explaining what each weight does. The `analyzePatterns` logic and leaderboard display from `feedback.ts` carry over unchanged.

### Storage

Store serialized weight JSON in the existing `competitor_versions.code` column — no schema migration needed for the table structure. The `enginePath` column is set to null for weight-tuned competitors (no disk files).

---

## Changes

### New files

| File | Purpose |
|------|---------|
| `src/competitors/weight-tuned/types.ts` | `WeightConfig` zod schema, `DEFAULT_WEIGHTS`, validation |
| `src/competitors/weight-tuned/features.ts` | `FeatureVector` type, `extractFeatures()`, individual feature fns |
| `src/competitors/weight-tuned/engine.ts` | `createWeightedEngine()` factory, `classifyMarket()` helper |
| `src/competitors/weight-tuned/feedback.ts` | `buildWeightFeedbackPrompt()` — weights + performance → LLM prompt |
| `src/competitors/weight-tuned/generator.ts` | `createWeightGenerator()` — calls LLM, returns `WeightConfig` |
| `src/competitors/weight-tuned/validator.ts` | `validateWeights()` — schema parse + test run |
| `src/competitors/weight-tuned/stake-validator.ts` | `validateStake()` — post-prediction bankroll constraint check |
| `src/competitors/weight-tuned/iteration.ts` | Orchestrates: read weights → get stats → generate → validate → store |
| `tests/unit/competitors/weight-tuned/features.test.ts` | Feature extraction edge cases |
| `tests/unit/competitors/weight-tuned/engine.test.ts` | Probabilities, market selection, staking |
| `tests/unit/competitors/weight-tuned/validator.test.ts` | Weight validation + stake validation |

### Modified files

| File | Change |
|------|--------|
| `src/domain/types/competitor.ts` | Add `"weight-tuned"` to `COMPETITOR_TYPES`, add `WeightTunedConfig` |
| `src/competitors/loader.ts` | Add `"weight-tuned"` case: load weights from `versionsRepo`, call `createWeightedEngine()`. Add `versionsRepo` to `LoaderDeps`. |
| `src/scripts/iterate.ts` | Wire up `createWeightIterationService`, handle `"weight-tuned"` type |
| `drizzle/0005_weight-tuned-competitors.sql` | Migration: insert weight-tuned competitors (one per LLM model) |

### Not changed

- `src/competitors/baseline/engine.ts` — stays as independent reference
- `src/competitors/llm-runtime/engine.ts` — different paradigm, unchanged
- `src/engine/runner.ts` — passes `Statistics` opaquely, unchanged
- `src/engine/validator.ts` — validates `PredictionOutput`, unchanged
- `src/orchestrator/pipeline.ts` — calls engines the same way, unchanged
- `src/domain/contracts/prediction.ts` — `PredictionOutput` unchanged
- `src/domain/contracts/statistics.ts` — `Statistics` unchanged

### Baseline stays separate

The baseline is essentially `createWeightedEngine(DEFAULT_WEIGHTS)` with simplifications (only uses first market, no probability distribution). Keeping it separate means:
- Stable reference point that never changes
- Useful comparison: do tuned weights outperform the fixed heuristic?
- No coupling between baseline stability and weight-tuned engine evolution

### Codegen files are not removed

The existing `src/competitors/llm-codegen/` directory stays for now. No codegen competitors need to be deleted or migrated. The weight-tuned system is additive — new competitor type alongside the existing ones.

---

## Implementation sequence

**Phase 1: Core engine**
1. `types.ts` — WeightConfig schema + DEFAULT_WEIGHTS
2. `features.ts` — 7 feature extraction functions
3. `engine.ts` — `createWeightedEngine` factory + `classifyMarket`
4. Unit tests for features and engine

**Phase 2: Iteration infrastructure**
5. `validator.ts` — weight validation
6. `generator.ts` — LLM weight generation via structured output
7. `feedback.ts` — feedback prompt builder (adapts existing patterns from codegen `feedback.ts`)
8. `iteration.ts` — orchestration service

**Phase 3: Integration**
9. `competitor.ts` — add `"weight-tuned"` type
10. `loader.ts` — add weight-tuned case (needs `versionsRepo` in deps)
11. `iterate.ts` — wire up new iteration service
12. DB migration — seed weight-tuned competitors
13. Integration tests

## Verification

1. `bun run typecheck` — no type errors
2. `bun test` — all tests pass (existing + new)
3. `bun run lint` — no lint errors
4. Manual: create a weight-tuned competitor, run pipeline, verify it produces predictions
5. Manual: run iterate, verify LLM outputs new weights, weights are stored in DB
