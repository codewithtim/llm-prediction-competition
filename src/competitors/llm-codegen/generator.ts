import type { OpenRouterClient } from "../../infrastructure/openrouter/client.ts";

export type GeneratedEngine = {
  competitorId: string;
  code: string;
  model: string;
};

const CODE_JSON_SCHEMA = {
  name: "generated_engine",
  schema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "The complete TypeScript source code for the prediction engine",
      },
    },
    required: ["code"],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT = `You are an expert TypeScript developer creating a football prediction engine.

You must write a TypeScript module that exports a default function conforming to the PredictionEngine type.

## Type Definitions

\`\`\`typescript
type Statistics = {
  fixtureId: number;
  league: { id: number; name: string; country: string; season: number };
  homeTeam: TeamStats;
  awayTeam: TeamStats;
  h2h: H2H;
  market: MarketContext;
};

type TeamStats = {
  teamId: number;
  teamName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: string | null;
  homeRecord: { played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number };
  awayRecord: { played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number };
};

type H2H = {
  totalMatches: number;
  homeWins: number;
  awayWins: number;
  draws: number;
  recentMatches: Array<{ date: string; homeTeam: string; awayTeam: string; homeGoals: number; awayGoals: number }>;
};

type MarketContext = {
  marketId: string;
  question: string;
  currentYesPrice: number;
  currentNoPrice: number;
  liquidity: number;
  volume: number;
  sportsMarketType: string | null;
  line: number | null;
};

type PredictionOutput = {
  marketId: string;    // Must match market.marketId
  side: "YES" | "NO";
  confidence: number;  // Between 0 and 1
  stake: number;       // Positive, between 1 and 10
  reasoning: string;   // 1-500 characters
};

type PredictionEngine = (statistics: Statistics) => PredictionOutput[] | Promise<PredictionOutput[]>;
\`\`\`

## Example: Baseline Engine

\`\`\`typescript
import type { PredictionOutput } from "../../domain/contracts/prediction";
import type { Statistics } from "../../domain/contracts/statistics";
import type { PredictionEngine } from "../../engine/types";

function parseForm(form: string | null): number {
  if (!form) return 0.5;
  let score = 0;
  let count = 0;
  for (const ch of form) {
    if (ch === "W") { score += 1; count++; }
    else if (ch === "D") { score += 0.5; count++; }
    else if (ch === "L") { count++; }
  }
  return count === 0 ? 0.5 : score / count;
}

const engine = ((statistics: Statistics): PredictionOutput[] => {
  const homeWinRate = statistics.homeTeam.homeRecord.played > 0
    ? statistics.homeTeam.homeRecord.wins / statistics.homeTeam.homeRecord.played
    : 0.5;
  const formAdv = (parseForm(statistics.homeTeam.form) - parseForm(statistics.awayTeam.form) + 1) / 2;
  const h2hAdv = statistics.h2h.totalMatches > 0
    ? statistics.h2h.homeWins / statistics.h2h.totalMatches
    : 0.5;

  const composite = 0.4 * homeWinRate + 0.3 * formAdv + 0.3 * h2hAdv;
  const side = composite >= 0.5 ? "YES" : "NO";
  const confidence = composite >= 0.5 ? composite : 1 - composite;
  const stake = Math.max(1, 1 + (confidence - 0.5) * 18);

  return [{
    marketId: statistics.market.marketId,
    side,
    confidence,
    stake,
    reasoning: \`Home win rate: \${(homeWinRate * 100).toFixed(0)}%, Composite: \${(composite * 100).toFixed(1)}%\`
  }];
}) satisfies PredictionEngine;

export default engine;
\`\`\`

## Requirements

1. Your code MUST export a default function that takes Statistics and returns PredictionOutput[]
2. Use the imports shown: \`import type { PredictionOutput } from "../../domain/contracts/prediction";\`, \`import type { Statistics } from "../../domain/contracts/statistics";\`, \`import type { PredictionEngine } from "../../engine/types";\`
3. The function must be synchronous (no async, no external API calls)
4. Always return at least one prediction
5. marketId must be \`statistics.market.marketId\`
6. confidence must be between 0 and 1
7. stake must be positive, between 1 and 10
8. reasoning must be 1-500 characters
9. Use a DIFFERENT strategy than the baseline — be creative with the statistics
10. Handle edge cases: zero played games, null form, zero H2H matches
11. Do NOT use any external libraries or APIs — pure TypeScript only`;

export function createCodeGenerator(deps: { client: OpenRouterClient }) {
  const { client } = deps;

  return {
    async generateEngine(params: {
      model: string;
      competitorId: string;
    }): Promise<GeneratedEngine> {
      const response = await client.chat({
        model: params.model,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt:
          "Generate a unique football prediction engine. Use a creative strategy that differs from the baseline example. Consider using different weights, additional statistics like goal difference, recent form trends, or value-based approaches comparing your confidence to market prices.",
        jsonSchema: CODE_JSON_SCHEMA,
        temperature: 0.8,
      });

      const parsed = JSON.parse(response) as { code: string };

      return {
        competitorId: params.competitorId,
        code: parsed.code,
        model: params.model,
      };
    },
  };
}
