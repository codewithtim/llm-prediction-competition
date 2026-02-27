# Feature 11: LLM Competitor Generation — Research

## Goal

Use OpenRouter to have LLMs write their own prediction engines. Each LLM receives the Statistics contract, PredictionOutput contract, baseline engine as reference, and writes its own engine code. The generated code is validated, tested, and committed to the repo.

## Existing Infrastructure

### OpenRouter SDK — Already installed

- Package: `@openrouter/sdk@^0.9.11` (in package.json)
- Env var: `OPENROUTER_API_KEY` already in `src/shared/env.ts`

**Client initialization:**
```typescript
import { OpenRouter } from "@openrouter/sdk";
const client = new OpenRouter({ apiKey: "..." });
```

**Chat completion:**
```typescript
const result = await client.chat.send({
  model: "anthropic/claude-sonnet-4",
  messages: [
    { role: "system", content: "..." },
    { role: "user", content: "..." },
  ],
  chatGenerationParams: { stream: false, temperature: 0.7 },
});
const content = result.choices[0].message.content;
```

**Key params:** `model`, `messages`, `temperature`, `maxCompletionTokens`, `responseFormat`

**Model IDs:**
- `anthropic/claude-sonnet-4` (Claude)
- `openai/gpt-4o` (GPT-4o)
- `google/gemini-2.0-flash-001` (Gemini)

### PredictionEngine Interface (`src/engine/types.ts`)

```typescript
type PredictionEngine = (
  statistics: Statistics,
) => PredictionOutput[] | Promise<PredictionOutput[]>;
```

- Pure function, receives `Statistics`, returns `PredictionOutput[]`
- Can be sync or async
- No external API calls — all data in Statistics

### Statistics Contract (`src/domain/contracts/statistics.ts`)

Full input received by engines:
- `fixtureId`, `league` (id, name, country, season)
- `homeTeam` / `awayTeam`: TeamStats (played, wins, draws, losses, goals, form, home/away records)
- `h2h`: H2H (totalMatches, homeWins, awayWins, draws, recentMatches)
- `market`: MarketContext (marketId, question, currentYesPrice, currentNoPrice, liquidity, volume, sportsMarketType, line)

### PredictionOutput Contract (`src/domain/contracts/prediction.ts`)

```typescript
type PredictionOutput = {
  marketId: string;           // Must match market.marketId
  side: "YES" | "NO";
  confidence: number;         // [0, 1]
  stake: number;              // positive
  reasoning: string;          // 1-500 chars
};
```

Validated by Zod schema in `src/engine/validator.ts`.

### Baseline Engine (`src/competitors/baseline/engine.ts`)

Reference implementation using weighted composite: 40% home win rate + 30% form advantage + 30% H2H. Exports `baselineEngine`, `BASELINE_ID`, `BASELINE_NAME`. 78 lines of pure TypeScript.

### Competitor Registry & DB

- Registry: `createRegistry()` → `.register(id, name, engine)`
- DB schema: `competitors` table with `id`, `name`, `model`, `enginePath`, `active`
- Repo: `competitorsRepo(db)` → `create()`, `findById()`, `findActive()`, `setActive()`

### Engine Runner (`src/engine/runner.ts`)

```typescript
runEngine(registered, statistics) → Promise<EngineResult | EngineError>
runAllEngines(engines, statistics) → Promise<Array<EngineResult | EngineError>>
```

Validates all output with Zod. Catches thrown errors.

### Pipeline Integration

Engines are registered in `src/index.ts` before pipeline starts. Pipeline calls `registry.getAll()` to get all engines, runs them all via `runAllEngines()`.

## Design Considerations

### Generation Flow

1. **Prompt** — send LLM the Statistics type, PredictionOutput type, baseline engine, and instructions
2. **Receive** — extract code from LLM response (fenced code block)
3. **Validate** — write to temp file, import, run against sample Statistics, check output passes Zod
4. **Save** — write to `src/competitors/<model>/engine.ts`
5. **Register** — record in DB + register in competitor registry

### Code Extraction

LLM responses contain prose + code blocks. Need to parse out the TypeScript code from markdown fenced blocks (` ```typescript ... ``` `).

### Validation Strategy

Before committing generated code:
1. Parse as valid TypeScript (Bun can import .ts directly)
2. Run against a sample `Statistics` object
3. Validate output passes `predictionOutputSchema`
4. Ensure it exports the required function

### LLM Instruction Prompt

The instruction document (`docs/llm-instructions.md`) does not exist yet — needs to be created. Should include:
- The `Statistics` type definition
- The `PredictionOutput` type definition
- The baseline engine as an example
- Constraints (no external calls, must be deterministic, 500 char reasoning limit)
- Football/soccer domain context

### Engine as Code vs Engine as LLM Call

Two architectural approaches:
1. **Code generation** — LLM writes TypeScript code once, committed to repo, runs locally
2. **Runtime LLM call** — engine calls OpenRouter at runtime with statistics as prompt

The research doc specifies approach #1: "LLMs write prediction engines that are committed to the repo. No sandboxing — code is reviewed and tested before running."

However, approach #2 is simpler for a first iteration and allows LLMs to use their full reasoning at prediction time. Could support both.
