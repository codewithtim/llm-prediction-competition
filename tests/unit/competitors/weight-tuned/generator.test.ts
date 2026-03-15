import { describe, expect, mock, test } from "bun:test";
import {
  createWeightGenerator,
  stripMarkdownFences,
  WEIGHT_SYSTEM_PROMPT,
} from "../../../../src/competitors/weight-tuned/generator";
import { DEFAULT_WEIGHTS } from "../../../../src/competitors/weight-tuned/types";

const VALID_JSON = JSON.stringify(DEFAULT_WEIGHTS);
const VALID_ENVELOPE = {
  weights: DEFAULT_WEIGHTS,
  changelog: [{ parameter: "signals.h2h", previous: 0.3, new: 0.1, reason: "test" }],
  overallAssessment: "Test assessment",
};
const VALID_ENVELOPE_JSON = JSON.stringify(VALID_ENVELOPE);

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
  test("describes output format for feedback and initial generation", () => {
    expect(WEIGHT_SYSTEM_PROMPT).toContain("changelog");
    expect(WEIGHT_SYSTEM_PROMPT).toContain("overallAssessment");
    expect(WEIGHT_SYSTEM_PROMPT).toContain("weights");
  });

  test("includes strategy guidance", () => {
    expect(WEIGHT_SYSTEM_PROMPT).toContain("Strategy Guidance");
    expect(WEIGHT_SYSTEM_PROMPT).toContain("drawBaseline");
    expect(WEIGHT_SYSTEM_PROMPT).toContain("sharpness");
    expect(WEIGHT_SYSTEM_PROMPT).toContain("minEdge");
    expect(WEIGHT_SYSTEM_PROMPT).toContain("kellyFraction");
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

    expect(result.parsed).toEqual(DEFAULT_WEIGHTS);
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

    expect(result.parsed).toEqual(DEFAULT_WEIGHTS);
    expect(result.rawResponse).toBe(wrappedResponse);
  });

  test("generateWithFeedback parses valid envelope JSON response", async () => {
    const mockClient = {
      chat: mock(() => Promise.resolve(VALID_ENVELOPE_JSON)),
    };
    const generator = createWeightGenerator({ client: mockClient });

    const result = await generator.generateWithFeedback({
      model: "test-model",
      competitorId: "wt-test",
      feedbackPrompt: "improve weights",
    });

    expect(result.parsed).toEqual(VALID_ENVELOPE);
  });

  test("generateWithFeedback handles markdown-wrapped JSON", async () => {
    const wrappedResponse = `\`\`\`json\n${VALID_ENVELOPE_JSON}\n\`\`\``;
    const mockClient = {
      chat: mock(() => Promise.resolve(wrappedResponse)),
    };
    const generator = createWeightGenerator({ client: mockClient });

    const result = await generator.generateWithFeedback({
      model: "test-model",
      competitorId: "wt-test",
      feedbackPrompt: "improve weights",
    });

    expect(result.parsed).toEqual(VALID_ENVELOPE);
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
