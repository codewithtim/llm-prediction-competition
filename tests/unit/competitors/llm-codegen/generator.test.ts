import { describe, expect, it, mock } from "bun:test";
import { createCodeGenerator } from "../../../../src/competitors/llm-codegen/generator.ts";
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

const sampleCode = `import type { PredictionOutput } from "../../domain/contracts/prediction";
import type { Statistics } from "../../domain/contracts/statistics";
const engine = (stats: Statistics): PredictionOutput[] => [{
  marketId: stats.market.marketId,
  side: "YES",
  confidence: 0.6,
  stake: 3,
  reasoning: "Test engine"
}];
export default engine;`;

describe("createCodeGenerator", () => {
  it("sends system prompt with type definitions and baseline example", async () => {
    const client = mockClient(JSON.stringify({ code: sampleCode }));
    const generator = createCodeGenerator({ client });

    await generator.generateEngine({
      model: "test/model",
      competitorId: "test-gen",
    });

    const args = firstCallArgs(client.chat);
    expect(args.systemPrompt).toContain("Statistics");
    expect(args.systemPrompt).toContain("PredictionOutput");
    expect(args.systemPrompt).toContain("PredictionEngine");
    expect(args.systemPrompt).toContain("Baseline Engine");
  });

  it("uses structured output JSON schema for code extraction", async () => {
    const client = mockClient(JSON.stringify({ code: sampleCode }));
    const generator = createCodeGenerator({ client });

    await generator.generateEngine({
      model: "test/model",
      competitorId: "test-gen",
    });

    const args = firstCallArgs(client.chat);
    expect(args.jsonSchema).toBeDefined();
    expect(args.jsonSchema?.name).toBe("generated_engine");
    expect((args.jsonSchema?.schema as Record<string, unknown>).properties).toBeDefined();
  });

  it("returns GeneratedEngine with code and metadata", async () => {
    const client = mockClient(JSON.stringify({ code: sampleCode }));
    const generator = createCodeGenerator({ client });

    const result = await generator.generateEngine({
      model: "test/model",
      competitorId: "test-gen",
    });

    expect(result.competitorId).toBe("test-gen");
    expect(result.model).toBe("test/model");
    expect(result.code).toBe(sampleCode);
  });

  it("uses the specified model", async () => {
    const client = mockClient(JSON.stringify({ code: sampleCode }));
    const generator = createCodeGenerator({ client });

    await generator.generateEngine({
      model: "anthropic/claude-sonnet-4",
      competitorId: "claude-gen",
    });

    const args = firstCallArgs(client.chat);
    expect(args.model).toBe("anthropic/claude-sonnet-4");
  });

  it("handles client errors", async () => {
    const client: OpenRouterClient = {
      chat: mock(() => Promise.reject(new Error("API error"))),
    };
    const generator = createCodeGenerator({ client });

    await expect(
      generator.generateEngine({
        model: "test/model",
        competitorId: "test-gen",
      }),
    ).rejects.toThrow("API error");
  });
});
