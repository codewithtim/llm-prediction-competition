import { describe, expect, mock, test } from "bun:test";
import {
  createWeightGenerator,
  stripMarkdownFences,
  WEIGHT_SYSTEM_PROMPT,
} from "../../../../src/competitors/weight-tuned/generator";
import { DEFAULT_WEIGHTS } from "../../../../src/competitors/weight-tuned/types";

const VALID_JSON = JSON.stringify(DEFAULT_WEIGHTS);

describe("stripMarkdownFences", () => {
  test("returns raw JSON unchanged", () => {
    expect(stripMarkdownFences(VALID_JSON)).toBe(VALID_JSON);
  });

  test("strips ```json fences", () => {
    const wrapped = `\`\`\`json\n${VALID_JSON}\n\`\`\``;
    expect(stripMarkdownFences(wrapped)).toBe(VALID_JSON);
  });

  test("strips ``` fences without language tag", () => {
    const wrapped = `\`\`\`\n${VALID_JSON}\n\`\`\``;
    expect(stripMarkdownFences(wrapped)).toBe(VALID_JSON);
  });

  test("strips fences with leading/trailing whitespace", () => {
    const wrapped = `  \`\`\`json\n${VALID_JSON}\n\`\`\`  `;
    expect(stripMarkdownFences(wrapped)).toBe(VALID_JSON);
  });

  test("handles fences with extra newlines", () => {
    const wrapped = `\`\`\`json\n\n${VALID_JSON}\n\n\`\`\``;
    const result = stripMarkdownFences(wrapped);
    expect(JSON.parse(result)).toEqual(DEFAULT_WEIGHTS);
  });
});

describe("WEIGHT_SYSTEM_PROMPT", () => {
  test("includes JSON schema for expected output format", () => {
    expect(WEIGHT_SYSTEM_PROMPT).toContain('"type": "object"');
    expect(WEIGHT_SYSTEM_PROMPT).toContain('"signals"');
    expect(WEIGHT_SYSTEM_PROMPT).toContain('"required"');
  });

  test("includes all required weight config fields in schema", () => {
    expect(WEIGHT_SYSTEM_PROMPT).toContain('"drawBaseline"');
    expect(WEIGHT_SYSTEM_PROMPT).toContain('"drawPeak"');
    expect(WEIGHT_SYSTEM_PROMPT).toContain('"drawWidth"');
    expect(WEIGHT_SYSTEM_PROMPT).toContain('"confidenceThreshold"');
    expect(WEIGHT_SYSTEM_PROMPT).toContain('"stakingAggression"');
    expect(WEIGHT_SYSTEM_PROMPT).toContain('"edgeMultiplier"');
    expect(WEIGHT_SYSTEM_PROMPT).toContain('"kellyFraction"');
  });
});

describe("createWeightGenerator", () => {
  test("generateWeights parses valid JSON response", async () => {
    const mockClient = {
      chat: mock(() => Promise.resolve(VALID_JSON)),
    };
    const generator = createWeightGenerator({ client: mockClient });

    const result = await generator.generateWeights({
      model: "test-model",
      competitorId: "wt-test",
    });

    expect(result.weights).toEqual(DEFAULT_WEIGHTS);
    expect(result.competitorId).toBe("wt-test");
    expect(result.model).toBe("test-model");
    expect(result.rawResponse).toBe(VALID_JSON);
  });

  test("generateWeights handles markdown-wrapped JSON", async () => {
    const wrappedResponse = `\`\`\`json\n${VALID_JSON}\n\`\`\``;
    const mockClient = {
      chat: mock(() => Promise.resolve(wrappedResponse)),
    };
    const generator = createWeightGenerator({ client: mockClient });

    const result = await generator.generateWeights({
      model: "test-model",
      competitorId: "wt-test",
    });

    expect(result.weights).toEqual(DEFAULT_WEIGHTS);
    expect(result.rawResponse).toBe(wrappedResponse);
  });

  test("generateWithFeedback parses valid JSON response", async () => {
    const mockClient = {
      chat: mock(() => Promise.resolve(VALID_JSON)),
    };
    const generator = createWeightGenerator({ client: mockClient });

    const result = await generator.generateWithFeedback({
      model: "test-model",
      competitorId: "wt-test",
      feedbackPrompt: "improve weights",
    });

    expect(result.weights).toEqual(DEFAULT_WEIGHTS);
  });

  test("generateWithFeedback handles markdown-wrapped JSON", async () => {
    const wrappedResponse = `\`\`\`json\n${VALID_JSON}\n\`\`\``;
    const mockClient = {
      chat: mock(() => Promise.resolve(wrappedResponse)),
    };
    const generator = createWeightGenerator({ client: mockClient });

    const result = await generator.generateWithFeedback({
      model: "test-model",
      competitorId: "wt-test",
      feedbackPrompt: "improve weights",
    });

    expect(result.weights).toEqual(DEFAULT_WEIGHTS);
  });

  test("throws on completely invalid response", async () => {
    const mockClient = {
      chat: mock(() => Promise.resolve("not json at all")),
    };
    const generator = createWeightGenerator({ client: mockClient });

    expect(
      generator.generateWeights({ model: "test-model", competitorId: "wt-test" }),
    ).rejects.toThrow();
  });
});
