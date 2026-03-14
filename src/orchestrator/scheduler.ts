import type { BetRetryService } from "../domain/services/bet-retry.ts";
import type { NotificationService } from "../domain/services/notification.ts";
import type { OrderConfirmationService } from "../domain/services/order-confirmation.ts";
import type { SettlementService } from "../domain/services/settlement.ts";
import type { NotificationEvent } from "../domain/types/notification.ts";
import { logger } from "../shared/logger.ts";
import type { PipelineConfig } from "./config.ts";
import type { DiscoveryPipeline } from "./discovery-pipeline.ts";
import type { FixtureStatusPipeline } from "./fixture-status-pipeline.ts";
import type { MarketRefreshPipeline } from "./market-refresh-pipeline.ts";
import type { PredictionPipeline } from "./prediction-pipeline.ts";
import type { RedemptionPipeline } from "./redemption-pipeline.ts";
import type { SummaryPipeline } from "./summary-pipeline.ts";

export type SchedulerDeps = {
  discoveryPipeline: DiscoveryPipeline;
  predictionPipeline: PredictionPipeline;
  settlementService: SettlementService;
  fixtureStatusPipeline: FixtureStatusPipeline;
  marketRefreshPipeline?: MarketRefreshPipeline;
  orderConfirmationService?: OrderConfirmationService;
  betRetryService?: BetRetryService;
  redemptionPipeline?: RedemptionPipeline;
  summaryPipeline?: SummaryPipeline;
  notificationService?: NotificationService;
  config: PipelineConfig;
};

export function createScheduler(deps: SchedulerDeps) {
  const {
    discoveryPipeline,
    predictionPipeline,
    settlementService,
    fixtureStatusPipeline,
    marketRefreshPipeline,
    orderConfirmationService,
    betRetryService,
    redemptionPipeline,
    summaryPipeline,
    notificationService,
    config,
  } = deps;

  function sendNotification(event: NotificationEvent, label: string) {
    notificationService?.notify(event).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Scheduler: ${label} notification failed`, { error: msg });
    });
  }

  let discoveryTimer: ReturnType<typeof setInterval> | null = null;
  let predictionTimer: ReturnType<typeof setInterval> | null = null;
  let settlementTimer: ReturnType<typeof setInterval> | null = null;
  let fixtureStatusTimer: ReturnType<typeof setInterval> | null = null;
  let orderConfirmationTimer: ReturnType<typeof setInterval> | null = null;
  let betRetryTimer: ReturnType<typeof setInterval> | null = null;
  let marketRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let redemptionTimer: ReturnType<typeof setInterval> | null = null;
  let summaryTimer: ReturnType<typeof setInterval> | null = null;
  let discoveryDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let predictionDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let settlementDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let marketRefreshDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let redemptionDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let discoveryRunning = false;
  let predictionRunning = false;
  let settlementRunning = false;
  let fixtureStatusRunning = false;
  let orderConfirmationRunning = false;
  let betRetryRunning = false;
  let marketRefreshRunning = false;
  let redemptionRunning = false;
  let summaryRunning = false;

  async function runDiscovery() {
    if (discoveryRunning) {
      logger.warn("Scheduler: discovery run skipped (previous run still in progress)");
      return;
    }
    discoveryRunning = true;
    const start = Date.now();
    try {
      logger.info("Scheduler: starting discovery run");
      const result = await discoveryPipeline.run();
      const durationMs = Date.now() - start;
      logger.info("Scheduler: discovery run complete", {
        durationMs,
        eventsDiscovered: result.eventsDiscovered,
        fixturesMatched: result.fixturesMatched,
        marketsUpserted: result.marketsUpserted,
        errors: result.errors.length,
      });
      for (const error of result.errors) {
        logger.error("Scheduler: discovery error", { message: error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Scheduler: discovery run failed", { error: msg });
    } finally {
      discoveryRunning = false;
    }
  }

  async function runPredictions() {
    if (predictionRunning) {
      logger.warn("Scheduler: prediction run skipped (previous run still in progress)");
      return;
    }
    predictionRunning = true;
    const start = Date.now();
    try {
      logger.info("Scheduler: starting prediction run");
      const result = await predictionPipeline.run();
      const durationMs = Date.now() - start;
      logger.info("Scheduler: prediction run complete", {
        durationMs,
        fixturesProcessed: result.fixturesProcessed,
        predictions: result.predictionsGenerated,
        betsPlaced: result.betsPlaced,
        errors: result.errors.length,
      });
      for (const error of result.errors) {
        logger.error("Scheduler: prediction error", { message: error });
      }

      if (result.placedBetDetails.length > 0) {
        sendNotification(
          {
            type: "bets_placed",
            bets: result.placedBetDetails.map((b) => ({
              competitorId: b.competitorId,
              marketQuestion: b.marketQuestion,
              fixtureLabel: b.fixtureLabel,
              side: b.side,
              amount: b.amount,
              price: b.price,
            })),
          },
          "bet placement",
        );
      }

      if (result.failedBetDetails.length > 0) {
        sendNotification(
          {
            type: "bets_failed",
            bets: result.failedBetDetails.map((b) => ({
              competitorId: b.competitorId,
              marketQuestion: b.marketQuestion,
              fixtureLabel: b.fixtureLabel,
              side: b.side,
              amount: b.amount,
              error: b.error,
            })),
          },
          "bet failure",
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Scheduler: prediction run failed", { error: msg });
    } finally {
      predictionRunning = false;
    }
  }

  async function runSettlement() {
    if (settlementRunning) {
      logger.warn("Scheduler: settlement run skipped (previous run still in progress)");
      return;
    }
    settlementRunning = true;
    const start = Date.now();
    try {
      logger.info("Scheduler: starting settlement run");
      const result = await settlementService.settleBets();
      const durationMs = Date.now() - start;
      logger.info("Scheduler: settlement run complete", {
        durationMs,
        settled: result.settled.length,
        skipped: result.skipped,
        errors: result.errors.length,
      });
      for (const error of result.errors) {
        logger.error("Scheduler: settlement error", { message: error });
      }

      if (result.settled.length > 0) {
        sendNotification(
          {
            type: "bets_settled",
            bets: result.settled.map((s) => ({
              betId: s.betId,
              competitorId: s.competitorId,
              marketQuestion: s.marketQuestion,
              side: s.side,
              outcome: s.outcome,
              profit: s.profit,
              amount: s.amount,
            })),
          },
          "settlement",
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Scheduler: settlement run failed", { error: msg });
    } finally {
      settlementRunning = false;
    }
  }

  async function runFixtureStatus() {
    if (fixtureStatusRunning) {
      logger.warn("Scheduler: fixture status run skipped (previous run still in progress)");
      return;
    }
    fixtureStatusRunning = true;
    const start = Date.now();
    try {
      logger.info("Scheduler: starting fixture status run");
      const result = await fixtureStatusPipeline.run();
      const durationMs = Date.now() - start;
      logger.info("Scheduler: fixture status run complete", {
        durationMs,
        fixturesChecked: result.fixturesChecked,
        statusesUpdated: result.statusesUpdated,
        errors: result.errors.length,
      });
      for (const error of result.errors) {
        logger.error("Scheduler: fixture status error", { message: error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Scheduler: fixture status run failed", { error: msg });
    } finally {
      fixtureStatusRunning = false;
    }
  }

  async function runOrderConfirmation() {
    if (!orderConfirmationService) return;
    if (orderConfirmationRunning) {
      logger.warn("Scheduler: order confirmation skipped (previous run still in progress)");
      return;
    }
    orderConfirmationRunning = true;
    const start = Date.now();
    try {
      logger.info("Scheduler: starting order confirmation run");
      const result = await orderConfirmationService.confirmOrders();
      const durationMs = Date.now() - start;
      logger.info("Scheduler: order confirmation run complete", {
        durationMs,
        confirmed: result.confirmed,
        cancelled: result.cancelled,
        failed: result.failed,
        stillPending: result.stillPending,
        errors: result.errors.length,
      });
      for (const error of result.errors) {
        logger.error("Scheduler: order confirmation error", { message: error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Scheduler: order confirmation run failed", { error: msg });
    } finally {
      orderConfirmationRunning = false;
    }
  }

  async function runBetRetry() {
    if (!betRetryService) return;
    if (betRetryRunning) {
      logger.warn("Scheduler: bet retry skipped (previous run still in progress)");
      return;
    }
    betRetryRunning = true;
    const start = Date.now();
    try {
      logger.info("Scheduler: starting bet retry run");
      const result = await betRetryService.retryFailedBets();
      const durationMs = Date.now() - start;
      logger.info("Scheduler: bet retry run complete", {
        durationMs,
        retried: result.retried,
        succeeded: result.succeeded,
        failedAgain: result.failedAgain,
        errors: result.errors.length,
      });
      for (const error of result.errors) {
        logger.error("Scheduler: bet retry error", { message: error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Scheduler: bet retry run failed", { error: msg });
    } finally {
      betRetryRunning = false;
    }
  }

  async function runSummary() {
    if (!summaryPipeline) return;
    if (summaryRunning) {
      logger.warn("Scheduler: summary run skipped (previous run still in progress)");
      return;
    }
    summaryRunning = true;
    const start = Date.now();
    try {
      logger.info("Scheduler: starting summary run");
      await summaryPipeline.run();
      const durationMs = Date.now() - start;
      logger.info("Scheduler: summary run complete", { durationMs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Scheduler: summary run failed", { error: msg });
    } finally {
      summaryRunning = false;
    }
  }

  async function runMarketRefresh() {
    if (!marketRefreshPipeline) return;
    if (marketRefreshRunning) {
      logger.warn("Scheduler: market refresh skipped (previous run still in progress)");
      return;
    }
    marketRefreshRunning = true;
    const start = Date.now();
    try {
      logger.info("Scheduler: starting market refresh run");
      const result = await marketRefreshPipeline.run();
      const durationMs = Date.now() - start;
      logger.info("Scheduler: market refresh run complete", {
        durationMs,
        eventsDiscovered: result.eventsDiscovered,
        marketsUpserted: result.marketsUpserted,
        errors: result.errors.length,
      });
      for (const error of result.errors) {
        logger.error("Scheduler: market refresh error", { message: error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Scheduler: market refresh run failed", { error: msg });
    } finally {
      marketRefreshRunning = false;
    }
  }

  async function runRedemption() {
    if (!redemptionPipeline) return;
    if (redemptionRunning) {
      logger.warn("Scheduler: redemption run skipped (previous run still in progress)");
      return;
    }
    redemptionRunning = true;
    const start = Date.now();
    try {
      logger.info("Scheduler: starting redemption run");
      const result = await redemptionPipeline.run();
      const durationMs = Date.now() - start;
      logger.info("Scheduler: redemption run complete", {
        durationMs,
        redeemed: result.redeemed,
        skipped: result.skipped,
        errors: result.errors.length,
      });
      for (const error of result.errors) {
        logger.error("Scheduler: redemption error", { message: error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Scheduler: redemption run failed", { error: msg });
    } finally {
      redemptionRunning = false;
    }
  }

  return {
    start() {
      logger.info("Scheduler: starting", {
        discoveryIntervalMs: config.discoveryIntervalMs,
        predictionIntervalMs: config.predictionIntervalMs,
        settlementIntervalMs: config.settlementIntervalMs,
        fixtureStatusIntervalMs: config.fixtureStatusIntervalMs,
        marketRefreshIntervalMs: config.marketRefreshIntervalMs,
        orderConfirmationIntervalMs: config.orderConfirmation.intervalMs,
        retryIntervalMs: config.retry.intervalMs,
      });

      // Run immediately (or after delay), then on interval
      if (config.discoveryDelayMs) {
        logger.info("Scheduler: delaying discovery start", { delayMs: config.discoveryDelayMs });
        discoveryDelayTimer = setTimeout(() => {
          runDiscovery();
          discoveryTimer = setInterval(runDiscovery, config.discoveryIntervalMs);
        }, config.discoveryDelayMs);
      } else {
        runDiscovery();
        discoveryTimer = setInterval(runDiscovery, config.discoveryIntervalMs);
      }

      if (config.predictionDelayMs) {
        logger.info("Scheduler: delaying prediction start", { delayMs: config.predictionDelayMs });
        predictionDelayTimer = setTimeout(() => {
          runPredictions();
          predictionTimer = setInterval(runPredictions, config.predictionIntervalMs);
        }, config.predictionDelayMs);
      } else {
        runPredictions();
        predictionTimer = setInterval(runPredictions, config.predictionIntervalMs);
      }

      if (config.settlementDelayMs) {
        logger.info("Scheduler: delaying settlement start", { delayMs: config.settlementDelayMs });
        settlementDelayTimer = setTimeout(() => {
          runSettlement();
          settlementTimer = setInterval(runSettlement, config.settlementIntervalMs);
        }, config.settlementDelayMs);
      } else {
        runSettlement();
        settlementTimer = setInterval(runSettlement, config.settlementIntervalMs);
      }

      // Fixture status runs immediately on interval
      runFixtureStatus();
      fixtureStatusTimer = setInterval(runFixtureStatus, config.fixtureStatusIntervalMs);

      // Order confirmation and bet retry run immediately on interval
      if (orderConfirmationService) {
        runOrderConfirmation();
        orderConfirmationTimer = setInterval(
          runOrderConfirmation,
          config.orderConfirmation.intervalMs,
        );
      }

      if (betRetryService) {
        runBetRetry();
        betRetryTimer = setInterval(runBetRetry, config.retry.intervalMs);
      }

      if (summaryPipeline) {
        if (config.summaryDelayMs) {
          logger.info("Scheduler: delaying summary start", { delayMs: config.summaryDelayMs });
          setTimeout(() => {
            runSummary();
            summaryTimer = setInterval(runSummary, config.summaryIntervalMs);
          }, config.summaryDelayMs);
        } else {
          runSummary();
          summaryTimer = setInterval(runSummary, config.summaryIntervalMs);
        }
      }

      if (marketRefreshPipeline) {
        if (config.marketRefreshDelayMs) {
          logger.info("Scheduler: delaying market refresh start", {
            delayMs: config.marketRefreshDelayMs,
          });
          marketRefreshDelayTimer = setTimeout(() => {
            runMarketRefresh();
            marketRefreshTimer = setInterval(runMarketRefresh, config.marketRefreshIntervalMs);
          }, config.marketRefreshDelayMs);
        } else {
          runMarketRefresh();
          marketRefreshTimer = setInterval(runMarketRefresh, config.marketRefreshIntervalMs);
        }
      }

      if (redemptionPipeline) {
        if (config.redemptionDelayMs) {
          logger.info("Scheduler: delaying redemption start", {
            delayMs: config.redemptionDelayMs,
          });
          redemptionDelayTimer = setTimeout(() => {
            runRedemption();
            redemptionTimer = setInterval(runRedemption, config.redemptionIntervalMs);
          }, config.redemptionDelayMs);
        } else {
          runRedemption();
          redemptionTimer = setInterval(runRedemption, config.redemptionIntervalMs);
        }
      }
    },

    stop() {
      logger.info("Scheduler: stopping");
      if (discoveryDelayTimer) {
        clearTimeout(discoveryDelayTimer);
        discoveryDelayTimer = null;
      }
      if (predictionDelayTimer) {
        clearTimeout(predictionDelayTimer);
        predictionDelayTimer = null;
      }
      if (settlementDelayTimer) {
        clearTimeout(settlementDelayTimer);
        settlementDelayTimer = null;
      }
      if (discoveryTimer) {
        clearInterval(discoveryTimer);
        discoveryTimer = null;
      }
      if (predictionTimer) {
        clearInterval(predictionTimer);
        predictionTimer = null;
      }
      if (settlementTimer) {
        clearInterval(settlementTimer);
        settlementTimer = null;
      }
      if (fixtureStatusTimer) {
        clearInterval(fixtureStatusTimer);
        fixtureStatusTimer = null;
      }
      if (orderConfirmationTimer) {
        clearInterval(orderConfirmationTimer);
        orderConfirmationTimer = null;
      }
      if (betRetryTimer) {
        clearInterval(betRetryTimer);
        betRetryTimer = null;
      }
      if (summaryTimer) {
        clearInterval(summaryTimer);
        summaryTimer = null;
      }
      if (marketRefreshDelayTimer) {
        clearTimeout(marketRefreshDelayTimer);
        marketRefreshDelayTimer = null;
      }
      if (marketRefreshTimer) {
        clearInterval(marketRefreshTimer);
        marketRefreshTimer = null;
      }
      if (redemptionDelayTimer) {
        clearTimeout(redemptionDelayTimer);
        redemptionDelayTimer = null;
      }
      if (redemptionTimer) {
        clearInterval(redemptionTimer);
        redemptionTimer = null;
      }
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
