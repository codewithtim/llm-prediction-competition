import {
  buildFeedbackPrompt as buildCodegenFeedback,
  type LeaderboardEntry,
  type PerformanceStats,
  type PredictionOutcome,
} from "../llm-codegen/feedback";
import type { WeightConfig } from "./types";

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
  // Reuse the codegen feedback builder to get the performance/outcomes/leaderboard sections
  const base = buildCodegenFeedback({
    currentCode: JSON.stringify(input.currentWeights, null, 2),
    performance: input.performance,
    recentOutcomes: input.recentOutcomes,
    leaderboard: input.leaderboard,
  });

  // Replace the code section with a structured weight display
  const weightsSection = `## Your Current Weight Configuration

\`\`\`json
${JSON.stringify(input.currentWeights, null, 2)}
\`\`\`

${formatWeightsTable(input.currentWeights)}`;

  // Replace the "Your Current Engine Code" section
  const codeHeader = "## Your Current Engine Code";
  const performanceHeader = "## Your Performance Summary";
  const codeStart = base.indexOf(codeHeader);
  const perfStart = base.indexOf(performanceHeader);

  if (codeStart !== -1 && perfStart !== -1) {
    return `${base.slice(0, codeStart)}${weightsSection}\n\n${base.slice(perfStart)}`;
  }

  // Fallback: prepend weights to the base prompt
  return `${weightsSection}\n\n${base}`;
}

export type { LeaderboardEntry, PerformanceStats, PredictionOutcome };
