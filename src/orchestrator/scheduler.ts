import { logger } from "../shared/logger.ts";
import type { PipelineConfig } from "./config.ts";
import type { Pipeline } from "./pipeline.ts";

export function createScheduler(pipeline: Pipeline, config: PipelineConfig) {
  let predictionTimer: ReturnType<typeof setInterval> | null = null;
  let settlementTimer: ReturnType<typeof setInterval> | null = null;
  let predictionRunning = false;
  let settlementRunning = false;

  async function runPredictions() {
    if (predictionRunning) {
      logger.warn("Scheduler: prediction run skipped (previous run still in progress)");
      return;
    }
    predictionRunning = true;
    const start = Date.now();
    try {
      logger.info("Scheduler: starting prediction run");
      const result = await pipeline.runPredictions();
      const durationMs = Date.now() - start;
      logger.info("Scheduler: prediction run complete", {
        durationMs,
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
      const result = await pipeline.runSettlement();
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
        predictionIntervalMs: config.predictionIntervalMs,
        settlementIntervalMs: config.settlementIntervalMs,
      });

      // Run immediately, then on interval
      runPredictions();
      runSettlement();

      predictionTimer = setInterval(runPredictions, config.predictionIntervalMs);
      settlementTimer = setInterval(runSettlement, config.settlementIntervalMs);
    },

    stop() {
      logger.info("Scheduler: stopping");
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
