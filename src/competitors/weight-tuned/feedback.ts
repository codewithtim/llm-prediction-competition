import type { ChangelogEntry, WeightConfig } from "./types";

export type PredictionOutcome = {
  marketQuestion: string;
  side: "YES" | "NO";
  confidence: number;
  stake: number;
  result: "won" | "lost" | "pending";
  profit: number | null;
  extractedFeatures?: Record<string, number>;
};

export type LeaderboardEntry = {
  name: string;
  accuracy: number;
  roi: number;
  profitLoss: number;
};

export type PerformanceStats = {
  totalBets: number;
  wins: number;
  losses: number;
  accuracy: number;
  roi: number;
  profitLoss: number;
  lockedAmount: number;
  totalStaked: number;
  totalReturned: number;
};

export type PerformanceRound = {
  version: number;
  dateFrom: string;
  dateTo: string;
  betsSettled: number;
  wins: number;
  losses: number;
  pnl: number;
  avgEdge: number;
  winningSignals: string[];
  losingSignals: string[];
};

export type WeightFeedbackInput = {
  currentWeights: WeightConfig;
  performance: PerformanceStats;
  recentOutcomes: PredictionOutcome[];
  leaderboard: LeaderboardEntry[];
  performanceHistory: PerformanceRound[];
  signalCorrelations: { winningSignals: string[]; losingSignals: string[] };
  previousReasoning?: {
    changelog: ChangelogEntry[];
    overallAssessment: string;
  };
};

const MAX_OUTCOMES = 20;

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCurrency(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

export function formatOutcomeFeatures(
  features: Record<string, number>,
  weights: Record<string, number>,
): string {
  return Object.entries(features)
    .filter(([name]) => (weights[name] ?? 0) > 0)
    .map(([name, val]) => `${name}=${(val * 100).toFixed(0)}% (w=${weights[name]?.toFixed(2)})`)
    .join(", ");
}

export function computeSignalCorrelations(
  outcomes: PredictionOutcome[],
  signalWeights: Record<string, number>,
): { winningSignals: string[]; losingSignals: string[] } {
  const settled = outcomes.filter((o) => o.result !== "pending" && o.extractedFeatures);
  const wins = settled.filter((o) => o.result === "won");
  const losses = settled.filter((o) => o.result === "lost");

  function topSignals(group: PredictionOutcome[]): string[] {
    if (group.length === 0) return [];
    const totals: Record<string, number> = {};
    for (const o of group) {
      for (const [name, value] of Object.entries(o.extractedFeatures ?? {})) {
        if ((signalWeights[name] ?? 0) > 0) {
          totals[name] = (totals[name] ?? 0) + (signalWeights[name] ?? 0) * value;
        }
      }
    }
    return Object.entries(totals)
      .map(([name, total]) => ({ name, avg: total / group.length }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 3)
      .map((s) => s.name);
  }

  return {
    winningSignals: topSignals(wins),
    losingSignals: topSignals(losses),
  };
}

export function formatPerformanceHistory(rounds: PerformanceRound[]): string {
  if (rounds.length === 0) return "No performance history yet.";

  return rounds
    .map(
      (r) => `Round ${r.version} (${r.dateFrom} → ${r.dateTo}, ${r.betsSettled} bets settled):
- Record: ${r.wins}W / ${r.losses}L
- P&L: ${formatCurrency(r.pnl)}
- Avg edge at bet time: ${formatPercentage(r.avgEdge)}
- Signals correlated with wins: ${r.winningSignals.length > 0 ? r.winningSignals.join(", ") : "insufficient data"}
- Signals correlated with losses: ${r.losingSignals.length > 0 ? r.losingSignals.join(", ") : "insufficient data"}`,
    )
    .join("\n\n");
}

function formatOutcomesWithFeatures(
  outcomes: PredictionOutcome[],
  signalWeights: Record<string, number>,
): string {
  if (outcomes.length === 0) return "No predictions yet.";

  const parts: string[] = [];
  for (const o of outcomes) {
    const resultEmoji = o.result === "won" ? "WIN" : o.result === "lost" ? "LOSS" : "PENDING";
    const profitStr = o.profit !== null ? formatCurrency(o.profit) : "-";
    let block = `**${o.marketQuestion}** → ${o.side} | Confidence: ${formatPercentage(o.confidence)} | Stake: ${o.stake.toFixed(1)} | ${resultEmoji} | P&L: ${profitStr}`;

    if (o.extractedFeatures && o.result !== "pending") {
      block += `\n  Features: ${formatOutcomeFeatures(o.extractedFeatures, signalWeights)}`;
    }
    parts.push(block);
  }
  return parts.join("\n\n");
}

function formatLeaderboard(leaderboard: LeaderboardEntry[]): string {
  if (leaderboard.length === 0) return "No competitors yet.";

  const rows = leaderboard.map((entry, i) => {
    return `| ${i + 1} | ${entry.name} | ${formatPercentage(entry.accuracy)} | ${formatPercentage(entry.roi)} | ${formatCurrency(entry.profitLoss)} |`;
  });

  return [
    "| Rank | Competitor | Accuracy | ROI | P&L |",
    "|------|------------|----------|-----|-----|",
    ...rows,
  ].join("\n");
}

function analyzePatterns(outcomes: PredictionOutcome[]): string[] {
  const suggestions: string[] = [];
  const settled = outcomes.filter((o) => o.result !== "pending");

  if (settled.length === 0) return suggestions;

  const yesBets = settled.filter((o) => o.side === "YES");
  const noBets = settled.filter((o) => o.side === "NO");

  if (yesBets.length > 0) {
    const yesWinRate = yesBets.filter((o) => o.result === "won").length / yesBets.length;
    if (yesWinRate < 0.4) {
      suggestions.push(
        "Your YES bets are underperforming — consider being more selective or adjusting your threshold for YES predictions.",
      );
    }
  }

  if (noBets.length > 0) {
    const noWinRate = noBets.filter((o) => o.result === "won").length / noBets.length;
    if (noWinRate < 0.4) {
      suggestions.push(
        "Your NO bets are underperforming — consider adjusting your strategy for NO predictions.",
      );
    }
  }

  const highConfLosses = settled.filter((o) => o.confidence > 0.7 && o.result === "lost");
  if (highConfLosses.length >= 2) {
    suggestions.push(
      `You had ${highConfLosses.length} high-confidence losses (>70%) — your confidence calibration may need adjustment.`,
    );
  }

  const avgStakeOnLoss =
    settled.filter((o) => o.result === "lost").length > 0
      ? settled.filter((o) => o.result === "lost").reduce((sum, o) => sum + o.stake, 0) /
        settled.filter((o) => o.result === "lost").length
      : 0;
  const avgStakeOnWin =
    settled.filter((o) => o.result === "won").length > 0
      ? settled.filter((o) => o.result === "won").reduce((sum, o) => sum + o.stake, 0) /
        settled.filter((o) => o.result === "won").length
      : 0;

  if (avgStakeOnLoss > avgStakeOnWin * 1.5 && avgStakeOnWin > 0) {
    suggestions.push(
      "You're staking more on losing bets than winning ones — consider adjusting your stake sizing strategy.",
    );
  }

  return suggestions;
}

function formatWeightsTable(weights: WeightConfig): string {
  const signalRows = Object.entries(weights.signals)
    .map(([name, val]) => `| ${name} | ${val.toFixed(3)} |`)
    .join("\n");

  return `### Signal Weights

| Signal | Weight |
|--------|--------|
${signalRows}

### Parameters

| Parameter | Value |
|-----------|-------|
| drawBaseline | ${weights.drawBaseline.toFixed(3)} |
| drawPeak | ${weights.drawPeak.toFixed(3)} |
| drawWidth | ${weights.drawWidth.toFixed(3)} |
| sharpness | ${weights.sharpness.toFixed(3)} |
| minEdge | ${weights.minEdge.toFixed(3)} |
| kellyFraction | ${weights.kellyFraction.toFixed(3)} |`;
}

function formatPreviousReasoning(
  reasoning: NonNullable<WeightFeedbackInput["previousReasoning"]>,
): string {
  const changelogLines = reasoning.changelog
    .map((c) => `- **${c.parameter}**: ${c.previous} → ${c.new} — ${c.reason}`)
    .join("\n");

  return `## Previous Assessment

${reasoning.overallAssessment}

### Changes Made Last Round

${changelogLines || "No changes recorded."}`;
}

export function buildWeightFeedbackPrompt(input: WeightFeedbackInput): string {
  const {
    currentWeights,
    performance,
    recentOutcomes,
    leaderboard,
    performanceHistory,
    signalCorrelations,
    previousReasoning,
  } = input;

  const truncatedOutcomes = recentOutcomes.slice(-MAX_OUTCOMES);

  const patterns = analyzePatterns(truncatedOutcomes);
  const patternSection =
    patterns.length > 0
      ? `## Improvement Suggestions\n\n${patterns.map((p) => `- ${p}`).join("\n")}`
      : "";

  const outcomesSection = formatOutcomesWithFeatures(truncatedOutcomes, currentWeights.signals);

  const weightsSection = `## Your Current Weight Configuration

\`\`\`json
${JSON.stringify(currentWeights, null, 2)}
\`\`\`

${formatWeightsTable(currentWeights)}`;

  const correlationNote =
    signalCorrelations.winningSignals.length > 0 || signalCorrelations.losingSignals.length > 0
      ? `\nOverall signal correlations — wins driven by: ${signalCorrelations.winningSignals.join(", ") || "insufficient data"}, losses driven by: ${signalCorrelations.losingSignals.join(", ") || "insufficient data"}.`
      : "";

  return `You are optimizing a weight configuration for a football betting engine. Your weights are the ONLY thing that controls predictions — the engine is purely mechanical. Review your performance data and generate improved weights.

## How the Engine Uses Your Weights

The engine takes your weights and computes predictions mechanically:

1. **Signal weights** → Each stat feature (homeWinRate, formDiff, h2h, etc.) is extracted as a 0-1 value where 1.0 = strongly favours home team. Your signal weights control how much each feature matters. The weighted average becomes **homeStrength** (0-1).

2. **Draw probability** → Computed via Gaussian: \`drawBaseline * exp(-((homeStrength - drawPeak)² / (2 * drawWidth²)))\`. Higher drawBaseline = more draws overall. drawPeak = the homeStrength where draws are most likely (0.5 = balanced teams). drawWidth = how wide the draw zone is.

3. **Win probabilities** → After removing drawProb, remaining probability is split using a power curve controlled by **sharpness**: \`pHome = remaining * homeStrength^sharpness / (homeStrength^sharpness + awayStrength^sharpness)\`. Higher sharpness = more extreme probability separation (sharpness=1 is linear, 2.5+ makes favourites much more dominant).

4. **Edge calculation** → For each market, edge = modelProb - marketPrice. Only the market with the highest edge is selected. If best edge < **minEdge**, no bet is placed.

5. **Stake sizing** → Uses fractional Kelly criterion: \`kellyFraction * max(0, (p*b - q) / b)\` where p = model probability, b = (1/marketPrice) - 1. Higher kellyFraction = bigger bets relative to edge.

Every parameter you set directly controls the output. There is no hidden logic.

${weightsSection}

## Performance History

${formatPerformanceHistory(performanceHistory)}

## Overall Performance

- Total Bets: ${performance.totalBets}
- Wins: ${performance.wins} | Losses: ${performance.losses}
- Accuracy: ${formatPercentage(performance.accuracy)}
- ROI: ${formatPercentage(performance.roi)}
- Profit/Loss: ${formatCurrency(performance.profitLoss)}
- Total Staked: ${formatCurrency(performance.totalStaked)}
- Total Returned: ${formatCurrency(performance.totalReturned)}
- Locked in Active Bets: ${formatCurrency(performance.lockedAmount)}

## Recent Prediction Outcomes (last ${truncatedOutcomes.length})

${outcomesSection}

## Leaderboard

${formatLeaderboard(leaderboard)}

${patternSection}

${previousReasoning ? formatPreviousReasoning(previousReasoning) : ""}

## Rules

- Do NOT overreact to a single bad matchday. Look at trends across multiple rounds.
- Small incremental adjustments (±0.05) are better than large swings unless performance is consistently poor across 3+ rounds.
- If a signal has been consistently unhelpful across 3+ rounds, consider reducing it significantly.
- If overall P&L is positive, be conservative with changes.
- If you have fewer than 10 settled bets total, make only minor adjustments — you don't have enough data to draw strong conclusions.
- Track your reasoning — what did you change and why?

## Instructions

Analyze your performance and generate an improved weight configuration. Focus on:
1. Which signal weights correlate with your wins vs losses? Increase reliable signals, reduce noisy ones.${correlationNote}
2. Is your sharpness appropriate? Too low = underdog probabilities too generous = bad value bets on underdogs. Too high = never finding edge on favourites.
3. Is your minEdge filtering well? Too low = placing marginal bets that lose to fees. Too high = missing good opportunities.
4. Is your kellyFraction sizing bets well? Too high = volatile bankroll swings. Too low = not capitalising on good edges.
5. Are your draw parameters producing reasonable draw probabilities for the matches you're seeing?
6. Strategies used by higher-ranked competitors (if you're not #1).

Generate an improved weight configuration.`;
}
