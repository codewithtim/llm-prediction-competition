import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PipelineConfig } from "../../../src/orchestrator/config.ts";
import type { DiscoveryPipeline } from "../../../src/orchestrator/discovery-pipeline.ts";
import type { PredictionPipeline } from "../../../src/orchestrator/prediction-pipeline.ts";
import { createScheduler, type SchedulerDeps } from "../../../src/orchestrator/scheduler.ts";

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    leagues: [],
    season: 2024,
    fixtureLookAheadDays: 7,
    discoveryIntervalMs: 100,
    predictionIntervalMs: 100,
    settlementIntervalMs: 100,
    betting: {
      maxStakePerBet: 10,
      maxBetPctOfBankroll: 0.1,
      maxTotalExposure: 100,
      initialBankroll: 100,
      minBetAmount: 0.01,
      dryRun: true,
    },
    orderConfirmation: {
      intervalMs: 100,
      maxOrderAgeMs: 60 * 60 * 1000,
    },
    retry: {
      intervalMs: 100,
      maxRetryAttempts: 3,
      retryDelayMs: 60_000,
    },
    ...overrides,
  };
}

function emptyDiscoveryResult() {
  return {
    eventsDiscovered: 0,
    fixturesFetched: 0,
    fixturesMatched: 0,
    marketsUpserted: 0,
    fixturesUpserted: 0,
    errors: [],
  };
}

function emptyPredictionResult() {
  return {
    fixturesProcessed: 0,
    predictionsGenerated: 0,
    betsPlaced: 0,
    betsDryRun: 0,
    betsSkipped: 0,
    oddsRefreshed: 0,
    oddsRefreshFailed: 0,
    errors: [],
  };
}

function mockDiscoveryPipeline(): DiscoveryPipeline {
  return {
    run: mock(() => Promise.resolve(emptyDiscoveryResult())),
  };
}

function mockPredictionPipeline(): PredictionPipeline {
  return {
    run: mock(() => Promise.resolve(emptyPredictionResult())),
  };
}

function mockSettlementService() {
  return {
    settleBets: mock(() => Promise.resolve({ settled: [], skipped: 0, errors: [] })),
  };
}

function buildDeps(overrides: Partial<SchedulerDeps> = {}): SchedulerDeps {
  return {
    discoveryPipeline: mockDiscoveryPipeline(),
    predictionPipeline: mockPredictionPipeline(),
    settlementService: mockSettlementService(),
    config: makeConfig(),
    ...overrides,
  };
}

describe("createScheduler", () => {
  let scheduler: ReturnType<typeof createScheduler> | null = null;

  afterEach(() => {
    scheduler?.stop();
    scheduler = null;
  });

  test("start() runs discovery immediately", async () => {
    const deps = buildDeps();
    scheduler = createScheduler(deps);
    scheduler.start();

    await new Promise((r) => setTimeout(r, 20));

    expect(deps.discoveryPipeline.run).toHaveBeenCalled();
  });

  test("start() runs predictions immediately", async () => {
    const deps = buildDeps();
    scheduler = createScheduler(deps);
    scheduler.start();

    await new Promise((r) => setTimeout(r, 20));

    expect(deps.predictionPipeline.run).toHaveBeenCalled();
  });

  test("start() runs settlement immediately", async () => {
    const deps = buildDeps();
    scheduler = createScheduler(deps);
    scheduler.start();

    await new Promise((r) => setTimeout(r, 20));

    expect(deps.settlementService.settleBets).toHaveBeenCalled();
  });

  test("stop() prevents further runs", async () => {
    const deps = buildDeps({
      config: makeConfig({
        discoveryIntervalMs: 50,
        predictionIntervalMs: 50,
        settlementIntervalMs: 50,
      }),
    });
    scheduler = createScheduler(deps);
    scheduler.start();

    await new Promise((r) => setTimeout(r, 20));
    scheduler.stop();

    const discoveryCalls = (deps.discoveryPipeline.run as ReturnType<typeof mock>).mock.calls
      .length;
    const predictionCalls = (deps.predictionPipeline.run as ReturnType<typeof mock>).mock.calls
      .length;
    const settlementCalls = (deps.settlementService.settleBets as ReturnType<typeof mock>).mock
      .calls.length;

    await new Promise((r) => setTimeout(r, 100));

    expect((deps.discoveryPipeline.run as ReturnType<typeof mock>).mock.calls.length).toBe(
      discoveryCalls,
    );
    expect((deps.predictionPipeline.run as ReturnType<typeof mock>).mock.calls.length).toBe(
      predictionCalls,
    );
    expect((deps.settlementService.settleBets as ReturnType<typeof mock>).mock.calls.length).toBe(
      settlementCalls,
    );
  });

  test("overlap guard prevents concurrent discovery runs", async () => {
    let resolveFirst: () => void = () => {};
    const slowDiscovery = mock(
      () =>
        new Promise<ReturnType<typeof emptyDiscoveryResult>>((resolve) => {
          resolveFirst = () => resolve(emptyDiscoveryResult());
        }),
    );

    const deps = buildDeps({
      discoveryPipeline: { run: slowDiscovery },
      config: makeConfig({ discoveryIntervalMs: 30 }),
    });
    scheduler = createScheduler(deps);
    scheduler.start();

    await new Promise((r) => setTimeout(r, 60));

    expect(slowDiscovery.mock.calls.length).toBe(1);

    resolveFirst();
    await new Promise((r) => setTimeout(r, 10));
  });

  test("delays prediction start when predictionDelayMs is set", async () => {
    const deps = buildDeps({
      config: makeConfig({ predictionDelayMs: 80 }),
    });
    scheduler = createScheduler(deps);
    scheduler.start();

    // Before the delay, prediction should not have been called
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.predictionPipeline.run).not.toHaveBeenCalled();

    // After the delay, prediction should have been called
    await new Promise((r) => setTimeout(r, 100));
    expect(deps.predictionPipeline.run).toHaveBeenCalled();
  });

  test("stop() clears delay timers before they fire", async () => {
    const deps = buildDeps({
      config: makeConfig({ predictionDelayMs: 80 }),
    });
    scheduler = createScheduler(deps);
    scheduler.start();

    // Stop before the delay fires
    await new Promise((r) => setTimeout(r, 20));
    scheduler.stop();

    // Wait past when the delay would have fired
    await new Promise((r) => setTimeout(r, 100));
    expect(deps.predictionPipeline.run).not.toHaveBeenCalled();
  });

  test("overlap guard prevents concurrent prediction runs", async () => {
    let resolveFirst: () => void = () => {};
    const slowPrediction = mock(
      () =>
        new Promise<ReturnType<typeof emptyPredictionResult>>((resolve) => {
          resolveFirst = () => resolve(emptyPredictionResult());
        }),
    );

    const deps = buildDeps({
      predictionPipeline: { run: slowPrediction },
      config: makeConfig({ predictionIntervalMs: 30 }),
    });
    scheduler = createScheduler(deps);
    scheduler.start();

    await new Promise((r) => setTimeout(r, 60));

    expect(slowPrediction.mock.calls.length).toBe(1);

    resolveFirst();
    await new Promise((r) => setTimeout(r, 10));
  });

  test("starts without optional services (orderConfirmation, betRetry)", async () => {
    const deps = buildDeps();
    // buildDeps omits optional services by default
    scheduler = createScheduler(deps);
    scheduler.start();

    await new Promise((r) => setTimeout(r, 20));

    // Core pipelines should still run
    expect(deps.discoveryPipeline.run).toHaveBeenCalled();
    expect(deps.predictionPipeline.run).toHaveBeenCalled();
    expect(deps.settlementService.settleBets).toHaveBeenCalled();
  });

  test("runs order confirmation immediately when provided", async () => {
    const confirmOrders = mock(() =>
      Promise.resolve({ confirmed: 0, cancelled: 0, failed: 0, stillPending: 0, errors: [] }),
    );
    const deps = buildDeps({
      orderConfirmationService: { confirmOrders },
    });
    scheduler = createScheduler(deps);
    scheduler.start();

    await new Promise((r) => setTimeout(r, 20));

    expect(confirmOrders).toHaveBeenCalled();
  });

  test("runs bet retry immediately when provided", async () => {
    const retryFailedBets = mock(() =>
      Promise.resolve({ retried: 0, succeeded: 0, failedAgain: 0, errors: [] }),
    );
    const deps = buildDeps({
      betRetryService: { retryFailedBets },
    });
    scheduler = createScheduler(deps);
    scheduler.start();

    await new Promise((r) => setTimeout(r, 20));

    expect(retryFailedBets).toHaveBeenCalled();
  });

  test("overlap guard prevents concurrent order confirmation runs", async () => {
    let resolveFirst: () => void = () => {};
    const slowConfirm = mock(
      () =>
        new Promise<{
          confirmed: number;
          cancelled: number;
          failed: number;
          stillPending: number;
          errors: string[];
        }>((resolve) => {
          resolveFirst = () =>
            resolve({ confirmed: 0, cancelled: 0, failed: 0, stillPending: 0, errors: [] });
        }),
    );

    const deps = buildDeps({
      orderConfirmationService: { confirmOrders: slowConfirm },
      config: makeConfig({
        orderConfirmation: { intervalMs: 30, maxOrderAgeMs: 60 * 60 * 1000 },
      }),
    });
    scheduler = createScheduler(deps);
    scheduler.start();

    await new Promise((r) => setTimeout(r, 60));

    expect(slowConfirm.mock.calls.length).toBe(1);

    resolveFirst();
    await new Promise((r) => setTimeout(r, 10));
  });

  test("stop() clears order confirmation and bet retry timers", async () => {
    const confirmOrders = mock(() =>
      Promise.resolve({ confirmed: 0, cancelled: 0, failed: 0, stillPending: 0, errors: [] }),
    );
    const retryFailedBets = mock(() =>
      Promise.resolve({ retried: 0, succeeded: 0, failedAgain: 0, errors: [] }),
    );
    const deps = buildDeps({
      orderConfirmationService: { confirmOrders },
      betRetryService: { retryFailedBets },
      config: makeConfig({
        orderConfirmation: { intervalMs: 50, maxOrderAgeMs: 60 * 60 * 1000 },
        retry: { intervalMs: 50, maxRetryAttempts: 3, retryDelayMs: 60_000 },
      }),
    });
    scheduler = createScheduler(deps);
    scheduler.start();

    await new Promise((r) => setTimeout(r, 20));
    scheduler.stop();

    const confirmCalls = (confirmOrders as ReturnType<typeof mock>).mock.calls.length;
    const retryCalls = (retryFailedBets as ReturnType<typeof mock>).mock.calls.length;

    await new Promise((r) => setTimeout(r, 100));

    expect((confirmOrders as ReturnType<typeof mock>).mock.calls.length).toBe(confirmCalls);
    expect((retryFailedBets as ReturnType<typeof mock>).mock.calls.length).toBe(retryCalls);
  });
});
