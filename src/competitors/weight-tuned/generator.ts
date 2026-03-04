import type { OpenRouterClient } from "../../infrastructure/openrouter/client";
import { FEATURE_REGISTRY } from "./features";
import { WEIGHT_JSON_SCHEMA, WEIGHT_OUTPUT_JSON_SCHEMA } from "./types";

export type GeneratedWeights = {
  competitorId: string;
  parsed: unknown;
  model: string;
  rawResponse: string;
};

/**
 * Strip markdown code fences from LLM responses.
 * Some models wrap JSON in ```json ... ``` despite structured output constraints.
 */
export function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:\w*)\n?([\s\S]*?)\n?```$/);
  return match ? (match[1] ?? "").trim() : trimmed;
}

function buildFeatureDescriptions(): string {
  return Object.entries(FEATURE_REGISTRY)
    .map(([name, entry]) => `- **${name}**: ${entry.description}`)
    .join("\n");
}

export const WEIGHT_SYSTEM_PROMPT = `You are optimizing a weight configuration for a football prediction engine. You never see individual matches — only aggregate results from how your weights performed.

## How The Engine Works

The engine computes a home-strength score as a weighted average of feature signals, then derives probabilities for home win, draw, and away win. It compares these to market prices to find value bets.

## Feature Signals (0-1 range, where 0.5 is neutral)

${buildFeatureDescriptions()}

## Output Format

When given performance feedback, respond with a JSON object containing:
1. **weights**: Your updated weight configuration
2. **changelog**: An array of changes you made, each with the parameter path, previous value, new value, and your reasoning
3. **overallAssessment**: A 2-4 sentence strategic summary of your analysis

When generating an initial configuration (no feedback), respond with just the weight configuration directly.

You MUST respond with ONLY valid JSON — no markdown, no code fences, no explanation.

## Strategy Guidance

- Signal weights are relative — they're normalized to sum to 1.0
- Set unused signals to 0.0 to disable them
- drawBaseline ~0.25 is typical for football; lower for leagues with fewer draws
- drawPeak ~0.5 means draws are most likely when teams are evenly matched
- Higher stakingAggression means betting more on every pick
- Higher edgeMultiplier means betting proportionally more when you see big edge
- Higher minEdge means being more selective (fewer but higher-conviction bets)
- confidenceThreshold prevents large bets on uncertain predictions
- Use a mix of signals for robustness; don't rely on just one

Generate an improved weight configuration based on the performance data provided.`;

export function createWeightGenerator(deps: { client: OpenRouterClient }) {
  const { client } = deps;

  return {
    async generateWeights(params: {
      model: string;
      competitorId: string;
    }): Promise<GeneratedWeights> {
      const response = await client.chat({
        model: params.model,
        systemPrompt: WEIGHT_SYSTEM_PROMPT,
        userPrompt:
          "Generate an optimal weight configuration for football match prediction. Be creative with your signal weights and parameters — try to find an edge that differs from a simple baseline approach.",
        jsonSchema: WEIGHT_JSON_SCHEMA,
        temperature: 0.8,
      });

      const parsed: unknown = JSON.parse(stripMarkdownFences(response));

      return {
        competitorId: params.competitorId,
        parsed,
        model: params.model,
        rawResponse: response,
      };
    },

    async generateWithFeedback(params: {
      model: string;
      competitorId: string;
      feedbackPrompt: string;
    }): Promise<GeneratedWeights> {
      const response = await client.chat({
        model: params.model,
        systemPrompt: WEIGHT_SYSTEM_PROMPT,
        userPrompt: params.feedbackPrompt,
        jsonSchema: WEIGHT_OUTPUT_JSON_SCHEMA,
        temperature: 0.8,
      });

      const parsed: unknown = JSON.parse(stripMarkdownFences(response));

      return {
        competitorId: params.competitorId,
        parsed,
        model: params.model,
        rawResponse: response,
      };
    },
  };
}
