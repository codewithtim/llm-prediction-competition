import type { SettlementService } from "../domain/services/settlement.ts";
import { logger } from "../shared/logger.ts";
import type { PipelineConfig } from "./config.ts";
import type { DiscoveryPipeline } from "./discovery-pipeline.ts";
import type { PredictionPipeline } from "./prediction-pipeline.ts";

export type SchedulerDeps = {
  discoveryPipeline: DiscoveryPipeline;
  predictionPipeline: PredictionPipeline;
  settlementService: SettlementService;
  config: PipelineConfig;
};

export function createScheduler(deps: SchedulerDeps) {
  const { discoveryPipeline, predictionPipeline, settlementService, config } = deps;

  let discoveryTimer: ReturnType<typeof setInterval> | null = null;
  let predictionTimer: ReturnType<typeof setInterval> | null = null;
  let settlementTimer: ReturnType<typeof setInterval> | null = null;
  let discoveryDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let predictionDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let settlementDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let discoveryRunning = false;
  let predictionRunning = false;
  let settlementRunning = false;

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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Scheduler: settlement run failed", { error: msg });
    } finally {
      settlementRunning = false;
    }
  }

  return {
    start() {
      logger.info("Scheduler: starting", {
        discoveryIntervalMs: config.discoveryIntervalMs,
        predictionIntervalMs: config.predictionIntervalMs,
        settlementIntervalMs: config.settlementIntervalMs,
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
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
