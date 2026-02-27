# Feature 11: LLM Competitor Generation — Plan

## Goal

Two types of LLM competitors that compete against each other and the baseline:

1. **Runtime LLM engines** — call OpenRouter at prediction time, LLM reasons over statistics and returns structured prediction JSON directly
2. **Code-generated engines** — call OpenRouter once to generate TypeScript prediction engine code, validate it, save to disk, register as a static competitor

Both use structured output (JSON schema) for clean extraction.

---

## Files to Create

### 1. `src/infrastructure/openrouter/client.ts`

Thin wrapper around the OpenRouter SDK.

**Exports:**
- `createOpenRouterClient(apiKey: string)` → `OpenRouterClient`

**Methods:**
- `chat(params: { model: string; systemPrompt: string; userPrompt: string; jsonSchema?: JsonSchema; temperature?: number; maxTokens?: number }): Promise<string>` — returns the text content from the first choice. When `jsonSchema` is provided, sets `responseFormat` to `json_schema` for structured output.

### 2. `src/competitors/llm-runtime/engine.ts`

Factory that creates a runtime LLM prediction engine. At prediction time, sends statistics to the LLM and gets back structured prediction JSON.

**Exports:**
- `createLlmRuntimeEngine(deps: { client: OpenRouterClient; model: string }): PredictionEngine`
- `PREDICTION_JSON_SCHEMA` — the JSON schema for structured output matching `PredictionOutput`
- `buildPredictionPrompt(statistics: Statistics): string` — builds the user prompt with serialized statistics

**How it works:**
1. Engine receives `Statistics`
2. Sends system prompt (football prediction expert instructions) + user prompt (serialized statistics)
3. Uses structured output JSON schema to get `{ marketId, side, confidence, stake, reasoning }`
4. Parses JSON response into `PredictionOutput[]`
5. Returns predictions (engine runner validates with Zod)

**System prompt** includes:
- Role: football prediction expert analyzing match data
- The `PredictionOutput` field descriptions and constraints
- Instruction to reason about home/away form, H2H, market odds, value

### 3. `src/competitors/llm-codegen/generator.ts`

Service that calls an LLM to generate prediction engine TypeScript code.

**Exports:**
- `createCodeGenerator(deps: { client: OpenRouterClient })`
  - `generateEngine(params: { model: string; competitorId: string }): Promise<GeneratedEngine>`

**`GeneratedEngine` type:**
```typescript
type GeneratedEngine = {
  competitorId: string;
  code: string;        // raw TypeScript source
  model: string;       // model that generated it
};
```

**How it works:**
1. Sends system prompt with full context: Statistics type, PredictionOutput type, PredictionEngine type, baseline engine as example
2. Uses structured output JSON schema: `{ code: string }` to get clean TypeScript without markdown fencing
3. Returns the generated code string

### 4. `src/competitors/llm-codegen/validator.ts`

Validates and loads generated engine code.

**Exports:**
- `validateGeneratedCode(code: string): Promise<ValidationResult>`

**`ValidationResult` type:**
```typescript
type ValidationResult =
  | { valid: true; engine: PredictionEngine }
  | { valid: false; error: string };
```

**How it works:**
1. Write code to a temp file (`/tmp/engine-{uuid}.ts`)
2. Dynamic import the temp file
3. Check it exports a function
4. Run the function with a sample `Statistics` fixture
5. Validate output passes `predictionOutputSchema`
6. Clean up temp file
7. Return the engine function if valid, or error message

### 5. `src/competitors/llm-codegen/engine.ts`

Manages saved codegen engines — loads from disk, provides a factory to create engines from saved code.

**Exports:**
- `loadCodegenEngine(enginePath: string): Promise<PredictionEngine>` — dynamically imports a saved engine file
- `saveGeneratedEngine(params: { competitorId: string; code: string }): Promise<string>` — writes code to `src/competitors/<competitorId>/engine.ts`, returns the file path

### 6. `src/competitors/llm-codegen/sample-statistics.ts`

A realistic sample `Statistics` object used for validating generated engines.

**Exports:**
- `SAMPLE_STATISTICS: Statistics` — a complete, realistic fixture (e.g., Arsenal vs Chelsea) with standings, form, H2H, market context

### 7. `tests/unit/competitors/llm-runtime/engine.test.ts`

Tests for runtime LLM engine.

**Test cases:**
- `buildPredictionPrompt` includes fixture/team/market data
- `PREDICTION_JSON_SCHEMA` is valid JSON schema matching PredictionOutput
- Engine calls client.chat with correct model and structured output schema
- Engine parses valid JSON response into PredictionOutput[]
- Engine handles malformed JSON gracefully (returns empty or throws for runner to catch)
- Engine handles client errors gracefully

### 8. `tests/unit/competitors/llm-codegen/generator.test.ts`

Tests for code generator.

**Test cases:**
- Generator sends system prompt with Statistics type, PredictionOutput type, baseline engine
- Generator uses structured output JSON schema for `{ code: string }`
- Generator returns GeneratedEngine with code and metadata
- Generator handles client errors

### 9. `tests/unit/competitors/llm-codegen/validator.test.ts`

Tests for code validator.

**Test cases:**
- Valid engine code passes validation
- Code that doesn't export a function fails
- Code that returns invalid PredictionOutput fails (wrong types)
- Code that throws at runtime fails
- Temp files are cleaned up after validation

---

## Files Modified

### `src/index.ts`

Add LLM runtime competitors to the registry at startup:

```typescript
import { createOpenRouterClient } from "./infrastructure/openrouter/client.ts";
import { createLlmRuntimeEngine } from "./competitors/llm-runtime/engine.ts";

const openrouter = createOpenRouterClient(env.OPENROUTER_API_KEY);

// Runtime LLM competitors
registry.register("claude-runtime", "Claude Sonnet (Runtime)",
  createLlmRuntimeEngine({ client: openrouter, model: "anthropic/claude-sonnet-4" }));
registry.register("gpt4o-runtime", "GPT-4o (Runtime)",
  createLlmRuntimeEngine({ client: openrouter, model: "openai/gpt-4o" }));
registry.register("gemini-runtime", "Gemini Flash (Runtime)",
  createLlmRuntimeEngine({ client: openrouter, model: "google/gemini-2.0-flash-001" }));
```

Code-generated competitors would be registered after generation (Feature 12 or manual trigger). For now, the code generator and validator are available as utilities but not wired into the pipeline automatically.

---

## Not in Scope

- Automatic code generation on startup (that's Feature 12 iteration loop)
- Iteration/feedback loop (Feature 12)
- Performance comparison UI
- Cost tracking per LLM call

## Dependencies

No new packages — `@openrouter/sdk` already installed.

## Verification

- [ ] `bun test` — all tests pass
- [ ] `bun run typecheck` — clean
- [ ] `bun run lint:fix` — clean
