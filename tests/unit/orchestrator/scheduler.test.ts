import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PipelineConfig } from "../../../src/orchestrator/config.ts";
import type { Pipeline } from "../../../src/orchestrator/pipeline.ts";
import { createScheduler } from "../../../src/orchestrator/scheduler.ts";

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    leagues: [],
    season: 2024,
    fixtureLookAheadDays: 7,
    predictionIntervalMs: 100,
    settlementIntervalMs: 100,
    discoveryTtlMs: 0,
    betting: { maxStakePerBet: 10, maxTotalExposure: 100, dryRun: true },
    ...overrides,
  };
}

function emptyResult() {
  return {
    eventsDiscovered: 0,
    fixturesFetched: 0,
    fixturesMatched: 0,
    fixturesProcessed: 0,
    predictionsGenerated: 0,
    betsPlaced: 0,
    betsDryRun: 0,
    betsSkipped: 0,
    cacheHit: false,
    oddsRefreshed: 0,
    oddsRefreshFailed: 0,
    errors: [],
  };
}

function mockPipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    runPredictions: mock(() => Promise.resolve(emptyResult())),
    runSettlement: mock(() => Promise.resolve({ settled: [], skipped: 0, errors: [] })),
    ...overrides,
  };
}

describe("createScheduler", () => {
  let scheduler: ReturnType<typeof createScheduler> | null = null;

  afterEach(() => {
    scheduler?.stop();
    scheduler = null;
  });

  test("start() runs predictions immediately", async () => {
    const pipeline = mockPipeline();
    const config = makeConfig();
    scheduler = createScheduler(pipeline, config);
    scheduler.start();

    // Give the async immediate call time to execute
    await new Promise((r) => setTimeout(r, 20));

    expect(pipeline.runPredictions).toHaveBeenCalled();
  });

  test("start() runs settlement immediately", async () => {
    const pipeline = mockPipeline();
    const config = makeConfig();
    scheduler = createScheduler(pipeline, config);
    scheduler.start();

    await new Promise((r) => setTimeout(r, 20));

    expect(pipeline.runSettlement).toHaveBeenCalled();
  });

  test("stop() prevents further runs", async () => {
    const pipeline = mockPipeline();
    const config = makeConfig({ predictionIntervalMs: 50, settlementIntervalMs: 50 });
    scheduler = createScheduler(pipeline, config);
    scheduler.start();

    // Wait for immediate run
    await new Promise((r) => setTimeout(r, 20));
    scheduler.stop();

    const predictionCalls = (pipeline.runPredictions as ReturnType<typeof mock>).mock.calls.length;
    const settlementCalls = (pipeline.runSettlement as ReturnType<typeof mock>).mock.calls.length;

    // Wait past interval to verify no additional calls
    await new Promise((r) => setTimeout(r, 100));

    expect((pipeline.runPredictions as ReturnType<typeof mock>).mock.calls.length).toBe(
      predictionCalls,
    );
    expect((pipeline.runSettlement as ReturnType<typeof mock>).mock.calls.length).toBe(
      settlementCalls,
    );
  });

  test("overlap guard prevents concurrent prediction runs", async () => {
    let resolveFirst: () => void = () => {};
    const slowPrediction = mock(
      () =>
        new Promise<ReturnType<typeof emptyResult>>((resolve) => {
          resolveFirst = () => resolve(emptyResult());
        }),
    );

    const pipeline = mockPipeline({ runPredictions: slowPrediction });
    const config = makeConfig({ predictionIntervalMs: 30 });
    scheduler = createScheduler(pipeline, config);
    scheduler.start();

    // Wait for interval to fire while first run is still pending
    await new Promise((r) => setTimeout(r, 60));

    // First call is still blocking, interval should have been skipped
    expect(slowPrediction.mock.calls.length).toBe(1);

    // Unblock
    resolveFirst();
    await new Promise((r) => setTimeout(r, 10));
  });

  test("overlap guard prevents concurrent settlement runs", async () => {
    let resolveFirst: () => void = () => {};
    const slowSettlement = mock(
      () =>
        new Promise<Awaited<ReturnType<Pipeline["runSettlement"]>>>((resolve) => {
          resolveFirst = () => resolve({ settled: [], skipped: 0, errors: [] });
        }),
    );

    const pipeline = mockPipeline({ runSettlement: slowSettlement });
    const config = makeConfig({ settlementIntervalMs: 30 });
    scheduler = createScheduler(pipeline, config);
    scheduler.start();

    // Wait for interval to fire while first run is still pending
    await new Promise((r) => setTimeout(r, 60));

    expect(slowSettlement.mock.calls.length).toBe(1);

    resolveFirst();
    await new Promise((r) => setTimeout(r, 10));
  });
});
