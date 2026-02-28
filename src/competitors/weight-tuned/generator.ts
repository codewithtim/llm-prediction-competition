import type { OpenRouterClient } from "../../infrastructure/openrouter/client";
import type { WeightConfig } from "./types";
import { WEIGHT_JSON_SCHEMA } from "./types";

export type GeneratedWeights = {
  competitorId: string;
  weights: WeightConfig;
  model: string;
};

export const WEIGHT_SYSTEM_PROMPT = `You are a football betting strategist tuning a prediction engine via weight configuration.

## How The Engine Works

The engine computes a home-strength score as a weighted average of feature signals, then derives probabilities for home win, draw, and away win. It compares these to market prices to find value bets.

## Feature Signals (0-1 range, where 0.5 is neutral)

- **homeWinRate**: Home team's win rate at home. Higher = stronger home team.
- **awayLossRate**: Away team's loss rate when playing away. Higher = weaker away team (good for home).
- **formDiff**: Recent form difference (home form vs away form). Higher = home in better form.
- **h2h**: Head-to-head advantage for home team. Higher = home historically dominant.
- **goalDiff**: Goal difference per game comparison. Higher = home scores/concedes better.
- **pointsPerGame**: Points per game comparison. Higher = home accumulates more points.
- **defensiveStrength**: Defensive comparison (away concedes more vs home concedes less). Higher = home defends better.

## Weight Config Format

\`\`\`json
{
  "signals": {
    "homeWinRate": 0.0-1.0,    // weight for home win rate signal
    "awayLossRate": 0.0-1.0,   // weight for away loss rate signal
    "formDiff": 0.0-1.0,       // weight for form difference signal
    "h2h": 0.0-1.0,            // weight for head-to-head signal
    "goalDiff": 0.0-1.0,       // weight for goal difference signal
    "pointsPerGame": 0.0-1.0,  // weight for points per game signal
    "defensiveStrength": 0.0-1.0 // weight for defensive strength signal
  },
  "drawBaseline": 0.0-0.5,      // base probability of a draw
  "drawPeak": 0.3-0.7,          // home strength where draw is most likely
  "drawWidth": 0.05-0.5,        // width of draw probability curve
  "confidenceThreshold": 0.0-1.0, // min confidence for aggressive staking
  "minEdge": 0.0-0.5,           // min edge over market price to consider
  "stakingAggression": 0.0-1.0, // base staking level
  "edgeMultiplier": 0.0-5.0,    // how much edge amplifies stake
  "kellyFraction": 0.0-1.0      // fraction of Kelly criterion to use
}
\`\`\`

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

Generate a weight configuration that you believe will perform well for football match prediction.`;

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

      const weights = JSON.parse(response) as WeightConfig;

      return {
        competitorId: params.competitorId,
        weights,
        model: params.model,
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
        jsonSchema: WEIGHT_JSON_SCHEMA,
        temperature: 0.8,
      });

      const weights = JSON.parse(response) as WeightConfig;

      return {
        competitorId: params.competitorId,
        weights,
        model: params.model,
      };
    },
  };
}
