import type { PredictionOutput } from "../../domain/contracts/prediction.ts";
import type { Statistics } from "../../domain/contracts/statistics.ts";
import type { PredictionEngine } from "../../engine/types.ts";
import type { OpenRouterClient } from "../../infrastructure/openrouter/client.ts";

export const PREDICTION_JSON_SCHEMA = {
  name: "predictions",
  schema: {
    type: "object",
    properties: {
      predictions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            marketId: { type: "string" },
            side: { type: "string", enum: ["YES", "NO"] },
            confidence: { type: "number" },
            stake: { type: "number" },
            reasoning: { type: "string" },
          },
          required: ["marketId", "side", "confidence", "stake", "reasoning"],
          additionalProperties: false,
        },
      },
    },
    required: ["predictions"],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT = `You are a football prediction expert. You analyze match statistics and betting market data to make informed predictions.

You will receive statistics for a football match including:
- League information
- Home and away team stats (form, win rates, goals, home/away records)
- Head-to-head history
- Multiple available betting markets for the same fixture (e.g. home win, away win, draw)

Your task is to choose the SINGLE best market and return ONE prediction as structured JSON.

Each prediction must have:
- marketId: the market ID from the input (must match exactly one of the available markets)
- side: "YES" or "NO" — your prediction on that market's question
- confidence: a number between 0 and 1 (0 = no confidence, 1 = certain)
- stake: a positive number between 1 and 10 representing how much to bet
- reasoning: a brief explanation (1-500 characters) of why you chose this market and prediction

Consider:
- Home/away form and win rates
- Head-to-head record between the teams
- Current market prices across ALL available markets — look for the best value
- Pick the single market where your confidence most diverges from the market price
- Higher stakes for higher confidence predictions where you see value`;

export function buildPredictionPrompt(statistics: Statistics): string {
  const { league, homeTeam, awayTeam, h2h, markets } = statistics;

  const marketsSection = markets
    .map(
      (market, i) =>
        `Market ${i + 1}:
  - Market ID: ${market.marketId}
  - Question: ${market.question}
  - Current YES price: ${market.currentYesPrice}
  - Current NO price: ${market.currentNoPrice}
  - Liquidity: ${market.liquidity}
  - Volume: ${market.volume}
  ${market.sportsMarketType ? `- Market type: ${market.sportsMarketType}` : ""}
  ${market.line !== null ? `- Line: ${market.line}` : ""}`,
    )
    .join("\n\n");

  return `Match: ${homeTeam.teamName} vs ${awayTeam.teamName}
League: ${league.name} (${league.country}, ${league.season})
Fixture ID: ${statistics.fixtureId}

HOME TEAM: ${homeTeam.teamName}
- Played: ${homeTeam.played}, W: ${homeTeam.wins}, D: ${homeTeam.draws}, L: ${homeTeam.losses}
- Goals: ${homeTeam.goalsFor} for, ${homeTeam.goalsAgainst} against (GD: ${homeTeam.goalDifference})
- Points: ${homeTeam.points}
- Form: ${homeTeam.form ?? "N/A"}
- Home record: P${homeTeam.homeRecord.played} W${homeTeam.homeRecord.wins} D${homeTeam.homeRecord.draws} L${homeTeam.homeRecord.losses}

AWAY TEAM: ${awayTeam.teamName}
- Played: ${awayTeam.played}, W: ${awayTeam.wins}, D: ${awayTeam.draws}, L: ${awayTeam.losses}
- Goals: ${awayTeam.goalsFor} for, ${awayTeam.goalsAgainst} against (GD: ${awayTeam.goalDifference})
- Points: ${awayTeam.points}
- Form: ${awayTeam.form ?? "N/A"}
- Away record: P${awayTeam.awayRecord.played} W${awayTeam.awayRecord.wins} D${awayTeam.awayRecord.draws} L${awayTeam.awayRecord.losses}

HEAD TO HEAD:
- Total matches: ${h2h.totalMatches}
- Home wins: ${h2h.homeWins}, Away wins: ${h2h.awayWins}, Draws: ${h2h.draws}
${h2h.recentMatches.length > 0 ? `- Recent: ${h2h.recentMatches.map((m) => `${m.homeTeam} ${m.homeGoals}-${m.awayGoals} ${m.awayTeam}`).join(", ")}` : ""}

AVAILABLE MARKETS:
${marketsSection}

Analyze the data and choose ONE market that represents the best value bet. Return a single prediction.`;
}

export function createLlmRuntimeEngine(deps: {
  client: OpenRouterClient;
  model: string;
}): PredictionEngine {
  const { client, model } = deps;

  return async (statistics: Statistics): Promise<PredictionOutput[]> => {
    const userPrompt = buildPredictionPrompt(statistics);

    const response = await client.chat({
      model,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      jsonSchema: PREDICTION_JSON_SCHEMA,
      temperature: 0.7,
    });

    const parsed = JSON.parse(response) as { predictions: PredictionOutput[] };
    return parsed.predictions;
  };
}
