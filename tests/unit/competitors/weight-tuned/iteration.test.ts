import { describe, expect, mock, test } from "bun:test";
import {
  createWeightIterationService,
  type WeightIterationDeps,
} from "../../../../src/competitors/weight-tuned/iteration";
import { DEFAULT_STAKE_CONFIG } from "../../../../src/competitors/weight-tuned/types";

// ─── Helpers ────────────────────────────────────────────────────────────

const VALID_WEIGHTS = {
  signals: {
    homeWinRate: 0.5,
    awayLossRate: 0.2,
    formDiff: 0.3,
    h2h: 0.1,
    goalDiff: 0.1,
    pointsPerGame: 0.2,
    defensiveStrength: 0.1,
  },
  drawBaseline: 0.25,
  drawPeak: 0.5,
  drawWidth: 0.15,
  confidenceThreshold: 0.52,
  minEdge: 0.05,
  stakingAggression: 0.5,
  edgeMultiplier: 2.0,
  kellyFraction: 0.25,
};

const COMPETITOR = {
  id: "wt-test",
  name: "Test Competitor",
  model: "openai/gpt-4o",
  enginePath: "",
  status: "active" as const,
  type: "weight-tuned" as const,
  config: '{"model":"openai/gpt-4o"}',
  createdAt: new Date(),
};

const EMPTY_STATS = {
  competitorId: "wt-test",
  totalBets: 0,
  wins: 0,
  losses: 0,
  pending: 0,
  totalStaked: 0,
  totalReturned: 0,
  profitLoss: 0,
  accuracy: 0,
  roi: 0,
};

function createMockDeps(overrides: Partial<WeightIterationDeps> = {}): WeightIterationDeps {
  const RAW_RESPONSE = JSON.stringify(VALID_WEIGHTS);

  const generateWeightsFn = mock(() =>
    Promise.resolve({
      competitorId: "wt-test",
      weights: VALID_WEIGHTS,
      model: "openai/gpt-4o",
      rawResponse: RAW_RESPONSE,
    }),
  );

  const generateWithFeedbackFn = mock(() =>
    Promise.resolve({
      competitorId: "wt-test",
      weights: VALID_WEIGHTS,
      model: "openai/gpt-4o",
      rawResponse: RAW_RESPONSE,
    }),
  );

  return {
    generator: {
      generateWeights: generateWeightsFn,
      generateWithFeedback: generateWithFeedbackFn,
    },
    competitorsRepo: {
      create: mock(() => Promise.resolve()),
      findById: mock(() => Promise.resolve(COMPETITOR)),
      findByStatus: mock(() => Promise.resolve([COMPETITOR])),
      setStatus: mock(() => Promise.resolve()),
      updateEnginePath: mock(() => Promise.resolve()),
    } as unknown as WeightIterationDeps["competitorsRepo"],
    versionsRepo: {
      create: mock(() => Promise.resolve()),
      findByCompetitor: mock(() => Promise.resolve([])),
      findLatest: mock(() => Promise.resolve(undefined)),
      findByVersion: mock(() => Promise.resolve(undefined)),
    } as unknown as WeightIterationDeps["versionsRepo"],
    betsRepo: {
      create: mock(() => Promise.resolve()),
      findById: mock(() => Promise.resolve(undefined)),
      findByCompetitor: mock(() => Promise.resolve([])),
      findByStatus: mock(() => Promise.resolve([])),
      updateStatus: mock(() => Promise.resolve()),
      getPerformanceStats: mock(() => Promise.resolve(EMPTY_STATS)),
    } as unknown as WeightIterationDeps["betsRepo"],
    predictionsRepo: {
      create: mock(() => Promise.resolve()),
      findByCompetitor: mock(() => Promise.resolve([])),
      findByMarket: mock(() => Promise.resolve([])),
      findByFixtureAndCompetitor: mock(() => Promise.resolve([])),
    } as unknown as WeightIterationDeps["predictionsRepo"],
    marketsRepo: {
      findById: mock(() => Promise.resolve(undefined)),
    } as unknown as WeightIterationDeps["marketsRepo"],
    registry: {
      register: mock(() => {}),
      unregister: mock(() => true),
      get: mock(() => undefined),
      getAll: mock(() => []),
    } as unknown as WeightIterationDeps["registry"],
    stakeConfig: DEFAULT_STAKE_CONFIG,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("createWeightIterationService", () => {
  describe("cold-start (no existing version)", () => {
    test("uses generateWeights when no version exists", async () => {
      const deps = createMockDeps();
      const service = createWeightIterationService(deps);

      const result = await service.iterateCompetitor("wt-test");

      expect(result.success).toBe(true);
      expect(deps.generator.generateWeights).toHaveBeenCalledTimes(1);
      expect(deps.generator.generateWithFeedback).not.toHaveBeenCalled();
    });

    test("passes correct model and competitorId to generateWeights", async () => {
      const deps = createMockDeps();
      const service = createWeightIterationService(deps);

      await service.iterateCompetitor("wt-test");

      expect(deps.generator.generateWeights).toHaveBeenCalledWith({
        model: "openai/gpt-4o",
        competitorId: "wt-test",
      });
    });

    test("saves version 1 on cold start", async () => {
      const deps = createMockDeps();
      const service = createWeightIterationService(deps);

      const result = await service.iterateCompetitor("wt-test");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.version).toBe(1);
      }
      expect(deps.versionsRepo.create).toHaveBeenCalledTimes(1);
    });

    test("saves raw LLM output in version record", async () => {
      const deps = createMockDeps();
      const service = createWeightIterationService(deps);

      await service.iterateCompetitor("wt-test");

      const createCall = (deps.versionsRepo.create as ReturnType<typeof mock>).mock.calls[0];
      const versionRecord = createCall?.[0] as Record<string, unknown>;
      expect(versionRecord?.rawLlmOutput).toBe(JSON.stringify(VALID_WEIGHTS));
    });
  });

  describe("iteration (existing version)", () => {
    test("uses generateWithFeedback when version exists", async () => {
      const deps = createMockDeps({
        versionsRepo: {
          create: mock(() => Promise.resolve()),
          findByCompetitor: mock(() => Promise.resolve([])),
          findLatest: mock(() =>
            Promise.resolve({
              id: 1,
              competitorId: "wt-test",
              version: 1,
              code: JSON.stringify(VALID_WEIGHTS),
              enginePath: "",
              model: "openai/gpt-4o",
              performanceSnapshot: null,
              generatedAt: new Date(),
            }),
          ),
          findByVersion: mock(() => Promise.resolve(undefined)),
        } as unknown as WeightIterationDeps["versionsRepo"],
      });
      const service = createWeightIterationService(deps);

      const result = await service.iterateCompetitor("wt-test");

      expect(result.success).toBe(true);
      expect(deps.generator.generateWithFeedback).toHaveBeenCalledTimes(1);
      expect(deps.generator.generateWeights).not.toHaveBeenCalled();
    });

    test("increments version number", async () => {
      const deps = createMockDeps({
        versionsRepo: {
          create: mock(() => Promise.resolve()),
          findByCompetitor: mock(() => Promise.resolve([])),
          findLatest: mock(() =>
            Promise.resolve({
              id: 1,
              competitorId: "wt-test",
              version: 3,
              code: JSON.stringify(VALID_WEIGHTS),
              enginePath: "",
              model: "openai/gpt-4o",
              performanceSnapshot: null,
              generatedAt: new Date(),
            }),
          ),
          findByVersion: mock(() => Promise.resolve(undefined)),
        } as unknown as WeightIterationDeps["versionsRepo"],
      });
      const service = createWeightIterationService(deps);

      const result = await service.iterateCompetitor("wt-test");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.version).toBe(4);
      }
    });
  });

  describe("error handling", () => {
    test("returns error for unknown competitor", async () => {
      const deps = createMockDeps({
        competitorsRepo: {
          create: mock(() => Promise.resolve()),
          findById: mock(() => Promise.resolve(undefined)),
          findByStatus: mock(() => Promise.resolve([])),
          setStatus: mock(() => Promise.resolve()),
          updateEnginePath: mock(() => Promise.resolve()),
        } as unknown as WeightIterationDeps["competitorsRepo"],
      });
      const service = createWeightIterationService(deps);

      const result = await service.iterateCompetitor("nonexistent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("not found");
      }
    });
  });

  describe("iterateAll", () => {
    test("iterates only weight-tuned competitors", async () => {
      const externalCompetitor = { ...COMPETITOR, id: "ext-1", type: "external" as const };
      const deps = createMockDeps({
        competitorsRepo: {
          create: mock(() => Promise.resolve()),
          findById: mock((id: string) => {
            if (id === "wt-test") return Promise.resolve(COMPETITOR);
            return Promise.resolve(undefined);
          }),
          findByStatus: mock(() => Promise.resolve([COMPETITOR, externalCompetitor])),
          setStatus: mock(() => Promise.resolve()),
          updateEnginePath: mock(() => Promise.resolve()),
        } as unknown as WeightIterationDeps["competitorsRepo"],
      });
      const service = createWeightIterationService(deps);

      const results = await service.iterateAll();

      // Should only iterate the weight-tuned competitor, not the external one
      expect(results).toHaveLength(1);
      expect(results[0]?.competitorId).toBe("wt-test");
    });
  });
});
