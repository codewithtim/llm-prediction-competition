import type { betsRepo as betsRepoFactory } from "../../database/repositories/bets";

export type BankrollProvider = {
  getBankroll(competitorId: string): Promise<number>;
};

export function createBankrollProvider(deps: {
  betsRepo: ReturnType<typeof betsRepoFactory>;
  initialBankroll: number;
}): BankrollProvider {
  const { betsRepo, initialBankroll } = deps;

  return {
    async getBankroll(competitorId: string): Promise<number> {
      const allBets = await betsRepo.findByCompetitor(competitorId);

      let settledPnL = 0;
      let pendingExposure = 0;

      for (const bet of allBets) {
        if (bet.status === "settled_won" || bet.status === "settled_lost") {
          settledPnL += bet.profit ?? 0;
        } else if (
          bet.status === "submitting" ||
          bet.status === "pending" ||
          bet.status === "filled"
        ) {
          pendingExposure += bet.amount;
        }
      }

      return Math.max(0, initialBankroll + settledPnL - pendingExposure);
    },
  };
}
