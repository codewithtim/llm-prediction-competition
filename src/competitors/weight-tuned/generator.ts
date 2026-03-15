import type { OpenRouterClient } from "../../apis/openrouter/client";
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

export const WEIGHT_SYSTEM_PROMPT = `You are optimizing a weight configuration for a football betting engine. Your weights are the ONLY thing that controls predictions — the engine is purely mechanical.

## How The Engine Uses Your Weights

1. **Signal weights** → Each feature is extracted as a 0-1 value (1.0 = strongly favours home team). Your signal weights control importance. The weighted average becomes **homeStrength** (0-1).

2. **Draw probability** → Gaussian: drawBaseline * exp(-((homeStrength - drawPeak)² / (2 * drawWidth²))). Higher drawBaseline = more draws. drawPeak = homeStrength where draws peak. drawWidth = width of draw zone.

3. **Win probabilities** → Power curve split: pHome = remaining * homeStrength^sharpness / (homeStrength^sharpness + awayStrength^sharpness). Higher sharpness = more extreme separation between favourite and underdog.

4. **Bet selection** → For each market, edge = modelProb - marketPrice. Best edge market is selected. If edge < minEdge, no bet.

5. **Stake sizing** → Fractional Kelly: kellyFraction * max(0, (p*b - q) / b) where p = model probability, b = (1/price) - 1.

## Feature Signals (0-1, where 0.5 is neutral)

${buildFeatureDescriptions()}

## Output Format

When given performance feedback, respond with a JSON object containing:
1. **weights**: Your updated weight configuration
2. **changelog**: An array of changes you made, each with the parameter path, previous value, new value, and your reasoning
3. **overallAssessment**: A 2-4 sentence strategic summary referencing specific metrics from your performance data (e.g. accuracy, ROI, signal correlations) to justify your changes

When generating an initial configuration (no feedback), respond with just the weight configuration directly.

You MUST respond with ONLY valid JSON — no markdown, no code fences, no explanation.

## Strategy Guidance

- Signal weights are relative — they're normalized. Set unused signals to 0.0
- drawBaseline ~0.25 is typical for football; lower for leagues with fewer draws
- drawPeak ~0.5 means draws are most likely when teams are evenly matched
- sharpness controls how extreme probabilities get. Too low (1.0) = underdogs overpriced. Too high (4+) = only extreme favourites get edge
- minEdge controls selectivity. Higher = fewer bets but stronger conviction
- kellyFraction controls bet sizing. 0.25 = conservative, 0.5 = moderate, 1.0 = aggressive (dangerous)
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
