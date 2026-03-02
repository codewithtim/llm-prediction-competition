export type StakeValidationConstraints = {
  maxBetPctOfBankroll: number;
  minBetAmount: number;
};

export function validateStake(
  stake: number,
  bankroll: number,
  constraints: StakeValidationConstraints,
): { valid: boolean; reason?: string } {
  if (bankroll < constraints.minBetAmount) {
    return {
      valid: false,
      reason: `Bankroll $${bankroll.toFixed(2)} is below minimum bet threshold`,
    };
  }

  if (stake <= 0) {
    return { valid: false, reason: "Stake must be positive" };
  }

  if (stake < constraints.minBetAmount) {
    return {
      valid: false,
      reason: `Stake $${stake.toFixed(2)} below minimum $${constraints.minBetAmount.toFixed(2)}`,
    };
  }

  const maxAllowed = bankroll * constraints.maxBetPctOfBankroll;
  if (stake > maxAllowed) {
    return {
      valid: false,
      reason: `Stake $${stake.toFixed(2)} exceeds ${(constraints.maxBetPctOfBankroll * 100).toFixed(0)}% of bankroll $${bankroll.toFixed(2)} (max $${maxAllowed.toFixed(2)})`,
    };
  }

  if (stake > bankroll) {
    return {
      valid: false,
      reason: `Stake $${stake.toFixed(2)} exceeds bankroll $${bankroll.toFixed(2)}`,
    };
  }

  return { valid: true };
}
