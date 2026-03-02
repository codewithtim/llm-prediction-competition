# Structured Reasoning — Plan

## Problem

Reasoning is currently stored as a flat pipe-delimited string:

```
Strength: 45.2% | P(home/draw/away): 45/10/45 | Edge: 2.3% | homeWinRate=50%, formDiff=30%
```

This is hard to display cleanly in the UI, impossible to query/filter against, and will get worse as more engine types (especially LLM-based ones) produce richer reasoning output. It should be structured JSON so the UI can render it with proper formatting.

## Current State

| Layer | File | Type |
|-------|------|------|
| Engine output | `src/competitors/weight-tuned/engine.ts:159-170` | String concatenation, truncated to 500 chars |
| Contract/schema | `src/domain/contracts/prediction.ts:8` | `z.string().min(1).max(500)` |
| DB column | `src/infrastructure/database/schema.ts:126` | `text("reasoning").notNull()` |
| Repository | `src/infrastructure/database/repositories/predictions.ts` | Pass-through string |
| API response | `src/shared/api-types.ts:129` | `reasoning: string` |
| UI | `ui/src/components/shared/reasoning-modal.tsx` | Rendered as `whitespace-pre-wrap` text in a modal |

Data can be wiped — no migration of existing rows needed.

## Target Shape

### Reasoning JSON Schema

Define a flexible but typed schema that works for both the current weight-tuned engine and future LLM-based engines:

```typescript
// src/domain/contracts/prediction.ts

export const reasoningSectionSchema = z.object({
  label: z.string(),          // e.g. "Probability", "Signals", "Edge Analysis"
  content: z.string(),        // Human-readable text for this section
  data: z.record(z.unknown()).optional(), // Optional structured key-value data
});

export const reasoningSchema = z.object({
  summary: z.string(),        // One-line summary (shown in table cell)
  sections: z.array(reasoningSectionSchema).min(1),
});

export type Reasoning = z.infer<typeof reasoningSchema>;
```

**Example — weight-tuned engine:**
```json
{
  "summary": "Home edge 2.3% at 45.2% strength — YES on moneyline",
  "sections": [
    {
      "label": "Probability",
      "content": "Home 45% | Draw 10% | Away 45%",
      "data": { "home": 0.45, "draw": 0.10, "away": 0.45 }
    },
    {
      "label": "Signals",
      "content": "homeWinRate=50%, formDiff=30%, h2h=20%",
      "data": { "homeWinRate": 0.50, "formDiff": 0.30, "h2h": 0.20 }
    },
    {
      "label": "Edge",
      "content": "2.3% edge on YES at 0.65",
      "data": { "edge": 0.023, "side": "YES", "marketPrice": 0.65 }
    }
  ]
}
```

**Example — future LLM engine:**
```json
{
  "summary": "Arsenal's home form and recent H2H dominance suggest value on YES",
  "sections": [
    {
      "label": "Analysis",
      "content": "Arsenal have won 8 of their last 10 home matches..."
    },
    {
      "label": "Key Factors",
      "content": "1. Strong home defensive record\n2. Opponent missing key striker\n3. Historical H2H advantage"
    },
    {
      "label": "Risk Assessment",
      "content": "Away team has improved recent form. Derby matches can be unpredictable."
    }
  ]
}
```

The `sections` array is open-ended — engines can include whatever sections make sense for their reasoning approach. The `summary` field gives the table cell a clean one-liner to display.

---

## Changes

### Step 1: Update the prediction contract

**File: `src/domain/contracts/prediction.ts`**

- Add `reasoningSectionSchema` and `reasoningSchema` as defined above
- Change `reasoning` field in `predictionOutputSchema` from `z.string().min(1).max(500)` to `reasoningSchema`
- Export the `Reasoning` type

### Step 2: Update the DB column

**File: `src/infrastructure/database/schema.ts`**

The `reasoning` column stays as `text` — SQLite doesn't have a native JSON column type. Drizzle stores JSON as serialised text. Change the column to use Drizzle's `{ mode: "json" }` option:

```typescript
reasoning: text("reasoning", { mode: "json" }).notNull().$type<Reasoning>(),
```

This makes Drizzle automatically `JSON.stringify()` on write and `JSON.parse()` on read.

### Step 3: Update the engine output

**File: `src/competitors/weight-tuned/engine.ts`**

Replace the string concatenation at lines 159-170 with a structured object:

```typescript
const reasoning: Reasoning = {
  summary: `${best.side} edge ${(best.edge * 100).toFixed(1)}% at ${(homeStrength * 100).toFixed(1)}% strength`,
  sections: [
    {
      label: "Probability",
      content: `Home ${(pHome * 100).toFixed(0)}% | Draw ${(drawProb * 100).toFixed(0)}% | Away ${(pAway * 100).toFixed(0)}%`,
      data: { home: pHome, draw: drawProb, away: pAway },
    },
    {
      label: "Signals",
      content: featuresSummary,
      data: Object.fromEntries(
        Object.entries(features).map(([k, v]) => [k, v]),
      ),
    },
    {
      label: "Edge",
      content: `${(best.edge * 100).toFixed(1)}% edge on ${best.side} at ${best.price.toFixed(2)}`,
      data: { edge: best.edge, side: best.side, price: best.price },
    },
  ],
};
```

Remove the `.slice(0, 500)` truncation — structured data doesn't need arbitrary length limits.

### Step 4: Update the engine validator

**File: `src/engine/validator.ts`**

The validator calls `predictionOutputSchema.safeParse()` — no changes needed here since the schema update in step 1 handles validation. Just verify it still passes after the schema change.

### Step 5: Update the prediction pipeline

**File: `src/orchestrator/prediction-pipeline.ts`**

No changes needed — `prediction.reasoning` is already passed through to `predictionsRepo.create()`. The Drizzle `{ mode: "json" }` handles serialisation automatically.

### Step 6: Update API types

**File: `src/shared/api-types.ts`**

Change `PredictionSummary.reasoning` from `string` to the structured type:

```typescript
export type ReasoningSection = {
  label: string;
  content: string;
  data?: Record<string, unknown>;
};

export type ReasoningDTO = {
  summary: string;
  sections: ReasoningSection[];
};

export type PredictionSummary = {
  // ... existing fields ...
  reasoning: ReasoningDTO;
};
```

### Step 7: Update API routes

**Files: `src/api/routes/predictions.ts`, `src/api/routes/competitors.ts`, `src/api/routes/fixtures.ts`**

The API routes currently pass `reasoning: p.reasoning` directly from the DB row. With Drizzle's JSON mode, this will already be a parsed object — no changes needed. Just verify the type flows through correctly.

### Step 8: Update the UI reasoning modal

**File: `ui/src/components/shared/reasoning-modal.tsx`**

Update `ReasoningCell` to accept the structured type and render it properly:

- **Table cell**: Show `reasoning.summary` (truncated as before)
- **Modal body**: Render each section as a labelled block:
  - Section label as a heading
  - Section content as body text
  - Optionally render `data` as a key-value grid if present

```tsx
// Table cell shows summary
<span className="truncate">{reasoning.summary}</span>

// Modal renders sections
{reasoning.sections.map((section) => (
  <div key={section.label}>
    <h4 className="font-medium text-zinc-200">{section.label}</h4>
    <p className="text-zinc-400">{section.content}</p>
    {section.data && (
      <div className="grid grid-cols-2 gap-x-4 text-xs font-mono text-zinc-500">
        {Object.entries(section.data).map(([k, v]) => (
          <Fragment key={k}>
            <span>{k}</span>
            <span>{typeof v === "number" ? v.toFixed(4) : String(v)}</span>
          </Fragment>
        ))}
      </div>
    )}
  </div>
))}
```

### Step 9: Wipe existing data

Run `drizzle-kit push` to apply the schema change. Since we're wiping data, no migration script is needed — just re-push the schema and let it recreate the predictions table (or drop and recreate via a one-time script).

### Step 10: Update tests

| Test file | Changes |
|-----------|---------|
| `tests/unit/domain/contracts/prediction.test.ts` | Update `reasoning` in test fixtures from strings to `{ summary, sections }` objects. Update validation tests. |
| `tests/unit/competitors/weight-tuned/engine.test.ts` | Assert reasoning is an object with `summary` and `sections` array, not a string. |
| `tests/unit/engine/validator.test.ts` | Update mock predictions to use structured reasoning. |
| `tests/unit/engine/runner.test.ts` | Update mock predictions. |
| `tests/unit/orchestrator/pipeline.test.ts` | Update mock predictions. |
| `tests/unit/api/*.test.ts` | Update mock prediction data with structured reasoning. |

---

## Implementation Order

| Step | What | Files |
|------|------|-------|
| 1 | Prediction contract: add `reasoningSchema`, update `predictionOutputSchema` | `src/domain/contracts/prediction.ts` |
| 2 | DB schema: switch reasoning column to `{ mode: "json" }` | `src/infrastructure/database/schema.ts` |
| 3 | Engine: output structured reasoning object | `src/competitors/weight-tuned/engine.ts` |
| 4 | API types: update `PredictionSummary.reasoning` to `ReasoningDTO` | `src/shared/api-types.ts` |
| 5 | UI: update `ReasoningCell` / modal to render sections | `ui/src/components/shared/reasoning-modal.tsx` |
| 6 | Tests: update all test fixtures | `tests/unit/**` |
| 7 | Wipe data + push schema | `drizzle-kit push` |

## Verification

1. `bun test` — all tests pass with structured reasoning
2. `bun run typecheck` — zero type errors across backend, shared types, and UI
3. `bun run build` in `ui/` — Vite build succeeds
4. Manual: run the pipeline against a fixture, verify prediction saved with JSON reasoning, verify UI modal renders sections correctly
