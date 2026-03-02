import type { WeightConfig } from "./types";

export type PredictionOutcome = {
  marketQuestion: string;
  side: "YES" | "NO";
  confidence: number;
  stake: number;
  result: "won" | "lost" | "pending";
  profit: number | null;
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
};

type FeedbackPromptInput = {
  currentConfig: string;
  performance: PerformanceStats;
  recentOutcomes: PredictionOutcome[];
  leaderboard: LeaderboardEntry[];
};

const MAX_OUTCOMES = 20;

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCurrency(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function formatOutcomesTable(outcomes: PredictionOutcome[]): string {
  if (outcomes.length === 0) return "No predictions yet.";

  const rows = outcomes.map((o) => {
    const resultEmoji = o.result === "won" ? "WIN" : o.result === "lost" ? "LOSS" : "PENDING";
    const profitStr = o.profit !== null ? formatCurrency(o.profit) : "-";
    return `| ${o.marketQuestion} | ${o.side} | ${formatPercentage(o.confidence)} | ${o.stake.toFixed(1)} | ${resultEmoji} | ${profitStr} |`;
  });

  return [
    "| Market | Side | Confidence | Stake | Result | Profit |",
    "|--------|------|------------|-------|--------|--------|",
    ...rows,
  ].join("\n");
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

function buildFeedbackPrompt(input: FeedbackPromptInput): string {
  const { currentConfig, performance, recentOutcomes, leaderboard } = input;

  const truncatedOutcomes = recentOutcomes.slice(-MAX_OUTCOMES);

  const patterns = analyzePatterns(truncatedOutcomes);
  const patternSection =
    patterns.length > 0
      ? `## Improvement Suggestions\n\n${patterns.map((p) => `- ${p}`).join("\n")}`
      : "";

  return `You are iterating on your football prediction engine. Review your current weight configuration and performance data below, then generate an improved version.

## Your Current Engine Code

\`\`\`typescript
${currentConfig}
\`\`\`

## Your Performance Summary

- Total Bets: ${performance.totalBets}
- Wins: ${performance.wins} | Losses: ${performance.losses}
- Accuracy: ${formatPercentage(performance.accuracy)}
- ROI: ${formatPercentage(performance.roi)}
- Profit/Loss: ${formatCurrency(performance.profitLoss)}

## Recent Prediction Outcomes (last ${truncatedOutcomes.length})

${formatOutcomesTable(truncatedOutcomes)}

## Leaderboard

${formatLeaderboard(leaderboard)}

${patternSection}

## Instructions

Analyze your performance and generate an improved prediction engine. Focus on:
1. Patterns in your wins and losses — what market conditions lead to each?
2. Your confidence calibration — are you overconfident or underconfident?
3. Your stake sizing — are you risking too much on uncertain bets?
4. Strategies used by higher-ranked competitors (if you're not #1)
5. Edge cases you may be missing

Generate an improved weight configuration that addresses these weaknesses.`;
}

export type WeightFeedbackInput = {
  currentWeights: WeightConfig;
  performance: PerformanceStats;
  recentOutcomes: PredictionOutcome[];
  leaderboard: LeaderboardEntry[];
};

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
| confidenceThreshold | ${weights.confidenceThreshold.toFixed(3)} |
| minEdge | ${weights.minEdge.toFixed(3)} |
| stakingAggression | ${weights.stakingAggression.toFixed(3)} |
| edgeMultiplier | ${weights.edgeMultiplier.toFixed(3)} |
| kellyFraction | ${weights.kellyFraction.toFixed(3)} |`;
}

export function buildWeightFeedbackPrompt(input: WeightFeedbackInput): string {
  const base = buildFeedbackPrompt({
    currentConfig: JSON.stringify(input.currentWeights, null, 2),
    performance: input.performance,
    recentOutcomes: input.recentOutcomes,
    leaderboard: input.leaderboard,
  });

  const weightsSection = `## Your Current Weight Configuration

\`\`\`json
${JSON.stringify(input.currentWeights, null, 2)}
\`\`\`

${formatWeightsTable(input.currentWeights)}`;

  const codeHeader = "## Your Current Engine Code";
  const performanceHeader = "## Your Performance Summary";
  const codeStart = base.indexOf(codeHeader);
  const perfStart = base.indexOf(performanceHeader);

  if (codeStart !== -1 && perfStart !== -1) {
    return `${base.slice(0, codeStart)}${weightsSection}\n\n${base.slice(perfStart)}`;
  }

  return `${weightsSection}\n\n${base}`;
}
