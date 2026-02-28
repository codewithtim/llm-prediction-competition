import type { PredictionOutput } from "../../domain/contracts/prediction";
import type { StakeConfig } from "./types";

export function validateStake(
  prediction: PredictionOutput,
  bankroll: number,
  constraints: StakeConfig,
): { valid: boolean; reason?: string } {
  if (prediction.stake <= 0) {
    return { valid: false, reason: "Stake must be positive" };
  }

  if (prediction.stake < constraints.minBet) {
    return {
      valid: false,
      reason: `Stake ${prediction.stake} below minimum ${constraints.minBet}`,
    };
  }

  const maxBet = bankroll * constraints.maxBetPct;
  if (prediction.stake > maxBet) {
    return {
      valid: false,
      reason: `Stake ${prediction.stake} exceeds max bet ${maxBet} (${constraints.maxBetPct * 100}% of ${bankroll})`,
    };
  }

  if (prediction.stake > bankroll) {
    return { valid: false, reason: `Stake ${prediction.stake} exceeds bankroll ${bankroll}` };
  }

  return { valid: true };
}
