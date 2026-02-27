import { describe, expect, it, mock } from "bun:test";
import { SAMPLE_STATISTICS } from "../../../../src/competitors/llm-codegen/sample-statistics.ts";
import {
  buildPredictionPrompt,
  createLlmRuntimeEngine,
  PREDICTION_JSON_SCHEMA,
} from "../../../../src/competitors/llm-runtime/engine.ts";
import type { PredictionOutput } from "../../../../src/domain/contracts/prediction.ts";
import type {
  ChatParams,
  OpenRouterClient,
} from "../../../../src/infrastructure/openrouter/client.ts";

function mockClient(response: string): OpenRouterClient {
  return {
    chat: mock(() => Promise.resolve(response)),
  };
}

function firstCallArgs(fn: OpenRouterClient["chat"]): ChatParams {
  // biome-ignore lint/suspicious/noExplicitAny: test helper accessing mock internals
  return ((fn as ReturnType<typeof mock>).mock.calls as any)[0][0] as ChatParams;
}

const validPrediction: PredictionOutput = {
  marketId: SAMPLE_STATISTICS.market.marketId,
  side: "YES",
  confidence: 0.72,
  stake: 5,
  reasoning: "Strong home form and H2H advantage",
};

describe("buildPredictionPrompt", () => {
  it("includes team names", () => {
    const prompt = buildPredictionPrompt(SAMPLE_STATISTICS);
    expect(prompt).toContain("Arsenal");
    expect(prompt).toContain("Chelsea");
  });

  it("includes league information", () => {
    const prompt = buildPredictionPrompt(SAMPLE_STATISTICS);
    expect(prompt).toContain("Premier League");
    expect(prompt).toContain("England");
  });

  it("includes market data", () => {
    const prompt = buildPredictionPrompt(SAMPLE_STATISTICS);
    expect(prompt).toContain(SAMPLE_STATISTICS.market.marketId);
    expect(prompt).toContain(SAMPLE_STATISTICS.market.question);
    expect(prompt).toContain("0.62");
  });

  it("includes team stats", () => {
    const prompt = buildPredictionPrompt(SAMPLE_STATISTICS);
    expect(prompt).toContain("W: 17");
    expect(prompt).toContain("WWDWW");
  });

  it("includes H2H data", () => {
    const prompt = buildPredictionPrompt(SAMPLE_STATISTICS);
    expect(prompt).toContain("Total matches: 10");
    expect(prompt).toContain("Home wins: 5");
  });
});

describe("PREDICTION_JSON_SCHEMA", () => {
  it("has required structure", () => {
    expect(PREDICTION_JSON_SCHEMA.name).toBe("predictions");
    expect(PREDICTION_JSON_SCHEMA.schema.type).toBe("object");
    expect(PREDICTION_JSON_SCHEMA.schema.properties.predictions).toBeDefined();
  });

  it("defines prediction items with all required fields", () => {
    const items = PREDICTION_JSON_SCHEMA.schema.properties.predictions.items;
    expect(items.required).toContain("marketId");
    expect(items.required).toContain("side");
    expect(items.required).toContain("confidence");
    expect(items.required).toContain("stake");
    expect(items.required).toContain("reasoning");
  });
});

describe("createLlmRuntimeEngine", () => {
  it("calls client.chat with correct model and schema", async () => {
    const client = mockClient(JSON.stringify({ predictions: [validPrediction] }));
    const engine = createLlmRuntimeEngine({ client, model: "test/model" });

    await engine(SAMPLE_STATISTICS);

    expect(client.chat).toHaveBeenCalledTimes(1);
    const args = firstCallArgs(client.chat);
    expect(args.model).toBe("test/model");
    expect(args.jsonSchema).toBeDefined();
    expect(args.jsonSchema?.name).toBe("predictions");
  });

  it("parses valid JSON response into PredictionOutput[]", async () => {
    const client = mockClient(JSON.stringify({ predictions: [validPrediction] }));
    const engine = createLlmRuntimeEngine({ client, model: "test/model" });

    const result = await engine(SAMPLE_STATISTICS);

    expect(result).toHaveLength(1);
    const first = result[0] as PredictionOutput;
    expect(first.marketId).toBe(SAMPLE_STATISTICS.market.marketId);
    expect(first.side).toBe("YES");
    expect(first.confidence).toBe(0.72);
  });

  it("throws on malformed JSON response", async () => {
    const client = mockClient("not json at all");
    const engine = createLlmRuntimeEngine({ client, model: "test/model" });

    await expect(engine(SAMPLE_STATISTICS)).rejects.toThrow();
  });

  it("propagates client errors", async () => {
    const client: OpenRouterClient = {
      chat: mock(() => Promise.reject(new Error("API rate limited"))),
    };
    const engine = createLlmRuntimeEngine({ client, model: "test/model" });

    await expect(engine(SAMPLE_STATISTICS)).rejects.toThrow("API rate limited");
  });

  it("includes system and user prompts", async () => {
    const client = mockClient(JSON.stringify({ predictions: [validPrediction] }));
    const engine = createLlmRuntimeEngine({ client, model: "test/model" });

    await engine(SAMPLE_STATISTICS);

    const args = firstCallArgs(client.chat);
    expect(args.systemPrompt).toContain("football prediction expert");
    expect(args.userPrompt).toContain("Arsenal");
  });
});
