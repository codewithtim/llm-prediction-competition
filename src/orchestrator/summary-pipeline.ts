import type { NotificationService } from "../domain/services/notification.ts";
import type { WeeklySummaryNotification } from "../domain/types/notification.ts";
import { logger } from "../shared/logger.ts";

type BetRow = {
  competitorId: string;
  amount: number;
  status: string;
  profit: number | null;
};

type SummaryPipelineDeps = {
  betsRepo: {
    findPlacedInRange(start: Date, end: Date): Promise<BetRow[]>;
    findSettledInRange(start: Date, end: Date): Promise<BetRow[]>;
  };
  fixturesRepo: {
    findScheduledUpcoming(): Promise<{ id: number }[]>;
  };
  competitorsRepo: {
    findAll(): Promise<{ id: string; name: string }[]>;
  };
  notificationService: Pick<NotificationService, "notify">;
};

export function createSummaryPipeline(deps: SummaryPipelineDeps) {
  const { betsRepo, fixturesRepo, competitorsRepo, notificationService } = deps;

  return {
    async run(): Promise<void> {
      const periodEnd = new Date();
      const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [placedBets, settledBets, upcomingFixtures, allCompetitors] = await Promise.all([
        betsRepo.findPlacedInRange(periodStart, periodEnd),
        betsRepo.findSettledInRange(periodStart, periodEnd),
        fixturesRepo.findScheduledUpcoming(),
        competitorsRepo.findAll(),
      ]);

      const competitorNames = new Map(allCompetitors.map((c) => [c.id, c.name]));

      const wins = settledBets.filter((b) => b.status === "settled_won").length;
      const losses = settledBets.filter((b) => b.status === "settled_lost").length;
      const totalStaked = settledBets.reduce((sum, b) => sum + b.amount, 0);
      const netPnl = settledBets.reduce((sum, b) => sum + (b.profit ?? 0), 0);

      const pnlByCompetitor = new Map<string, number>();
      for (const bet of settledBets) {
        const current = pnlByCompetitor.get(bet.competitorId) ?? 0;
        pnlByCompetitor.set(bet.competitorId, current + (bet.profit ?? 0));
      }

      let topCompetitor: WeeklySummaryNotification["topCompetitor"] = null;
      if (pnlByCompetitor.size > 0) {
        let bestId = "";
        let bestPnl = -Infinity;
        for (const [id, pnl] of pnlByCompetitor) {
          if (pnl > bestPnl) {
            bestId = id;
            bestPnl = pnl;
          }
        }
        topCompetitor = {
          id: bestId,
          name: competitorNames.get(bestId) ?? bestId,
          pnl: bestPnl,
        };
      }

      const summary: WeeklySummaryNotification = {
        periodStart: periodStart.toISOString().slice(0, 10),
        periodEnd: periodEnd.toISOString().slice(0, 10),
        totalBetsPlaced: placedBets.length,
        totalBetsSettled: settledBets.length,
        wins,
        losses,
        winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
        totalStaked,
        netPnl,
        topCompetitor,
        upcomingFixtures: upcomingFixtures.length,
      };

      logger.info("Summary pipeline: dispatching weekly summary", {
        totalBetsPlaced: summary.totalBetsPlaced,
        totalBetsSettled: summary.totalBetsSettled,
        netPnl: summary.netPnl,
      });

      await notificationService.notify({ type: "weekly_summary", summary });
    },
  };
}

export type SummaryPipeline = ReturnType<typeof createSummaryPipeline>;
