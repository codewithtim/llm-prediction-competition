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
    injuryImpact: 0.0,
    cleanSheetDiff: 0.0,
    scoringConsistency: 0.0,
    winStreakMomentum: 0.0,
    penaltyReliability: 0.0,
    lateGoalThreat: 0.0,
    lateGoalVulnerability: 0.0,
    overTwoFiveGoals: 0.0,
    defensiveOverTwoFive: 0.0,
    squadRating: 0.0,
    attackingOutput: 0.0,
    injuredKeyPlayers: 0.0,
    h2hRecentForm: 0.0,
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
  failed: 0,
  lockedAmount: 0,
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
      getAllPerformanceStats: mock(() => Promise.resolve(new Map())),
    } as unknown as WeightIterationDeps["betsRepo"],
    predictionsRepo: {
      create: mock(() => Promise.resolve()),
      findByCompetitor: mock(() => Promise.resolve([])),
      findByMarket: mock(() => Promise.resolve([])),
      findByFixtureAndCompetitor: mock(() => Promise.resolve([])),
    } as unknown as WeightIterationDeps["predictionsRepo"],
    marketsRepo: {
      findById: mock(() => Promise.resolve(undefined)),
      findByIds: mock(() => Promise.resolve([])),
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

    test("feedback prompt includes extractedFeatures from predictions", async () => {
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
        predictionsRepo: {
          create: mock(() => Promise.resolve()),
          findByCompetitor: mock(() =>
            Promise.resolve([
              {
                id: 1,
                marketId: "m1",
                fixtureId: 100,
                competitorId: "wt-test",
                side: "YES" as const,
                confidence: 0.72,
                stake: 3.0,
                reasoning: { summary: "test", sections: [{ label: "x", content: "y" }] },
                extractedFeatures: { homeWinRate: 0.9, formDiff: 0.6, h2h: 0.6 },
                createdAt: new Date(),
              },
            ]),
          ),
          findByMarket: mock(() => Promise.resolve([])),
          findByFixtureAndCompetitor: mock(() => Promise.resolve([])),
        } as unknown as WeightIterationDeps["predictionsRepo"],
        betsRepo: {
          create: mock(() => Promise.resolve()),
          findById: mock(() => Promise.resolve(undefined)),
          findByCompetitor: mock(() =>
            Promise.resolve([
              {
                id: "b1",
                marketId: "m1",
                fixtureId: 100,
                competitorId: "wt-test",
                tokenId: "t1",
                side: "YES" as const,
                amount: 3.0,
                price: 0.65,
                shares: 4.6,
                status: "settled_won" as const,
                placedAt: new Date(),
                settledAt: new Date(),
                profit: 1.6,
                errorMessage: null,
                errorCategory: null,
                attempts: 1,
                lastAttemptAt: null,
                orderId: null,
              },
            ]),
          ),
          findByStatus: mock(() => Promise.resolve([])),
          updateStatus: mock(() => Promise.resolve()),
          getPerformanceStats: mock(() => Promise.resolve(EMPTY_STATS)),
          getAllPerformanceStats: mock(() => Promise.resolve(new Map())),
        } as unknown as WeightIterationDeps["betsRepo"],
        marketsRepo: {
          findById: mock(() =>
            Promise.resolve({ id: "m1", question: "Will Arsenal win?" }),
          ),
          findByIds: mock(() =>
            Promise.resolve([{ id: "m1", question: "Will Arsenal win?" }]),
          ),
        } as unknown as WeightIterationDeps["marketsRepo"],
      });
      const service = createWeightIterationService(deps);

      await service.iterateCompetitor("wt-test");

      const call = (deps.generator.generateWithFeedback as ReturnType<typeof mock>).mock.calls[0];
      const feedbackPrompt = (call?.[0] as { feedbackPrompt: string })?.feedbackPrompt;
      expect(feedbackPrompt).toContain("Features:");
      expect(feedbackPrompt).toContain("homeWinRate=90%");
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
    function depsWithFindById(
      findById: WeightIterationDeps["competitorsRepo"]["findById"],
    ) {
      return createMockDeps({
        competitorsRepo: {
          ...createMockDeps().competitorsRepo,
          findById,
        } as unknown as WeightIterationDeps["competitorsRepo"],
      });
    }

    test("returns error for unknown competitor", async () => {
      const deps = depsWithFindById(mock(() => Promise.resolve(undefined)));
      const service = createWeightIterationService(deps);

      const result = await service.iterateCompetitor("nonexistent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("not found");
      }
    });

    test("returns error for disabled competitor", async () => {
      const deps = depsWithFindById(
        mock(() => Promise.resolve({ ...COMPETITOR, status: "disabled" as const })),
      );
      const service = createWeightIterationService(deps);

      const result = await service.iterateCompetitor("wt-test");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("disabled");
      }
    });

    test("returns error for error-state competitor", async () => {
      const deps = depsWithFindById(
        mock(() => Promise.resolve({ ...COMPETITOR, status: "error" as const })),
      );
      const service = createWeightIterationService(deps);

      const result = await service.iterateCompetitor("wt-test");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("error");
      }
    });

    test("allows iteration for pending competitor", async () => {
      const deps = depsWithFindById(
        mock(() => Promise.resolve({ ...COMPETITOR, status: "pending" as const })),
      );
      const service = createWeightIterationService(deps);

      const result = await service.iterateCompetitor("wt-test");

      expect(result.success).toBe(true);
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
          findByStatus: mock((status: string) => {
            if (status === "active") return Promise.resolve([COMPETITOR, externalCompetitor]);
            return Promise.resolve([]);
          }),
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

    test("includes pending weight-tuned competitors", async () => {
      const pendingCompetitor = { ...COMPETITOR, id: "wt-pending", status: "pending" as const };
      const deps = createMockDeps({
        competitorsRepo: {
          create: mock(() => Promise.resolve()),
          findById: mock((id: string) => {
            if (id === "wt-test") return Promise.resolve(COMPETITOR);
            if (id === "wt-pending") return Promise.resolve(pendingCompetitor);
            return Promise.resolve(undefined);
          }),
          findByStatus: mock((status: string) => {
            if (status === "active") return Promise.resolve([COMPETITOR]);
            if (status === "pending") return Promise.resolve([pendingCompetitor]);
            return Promise.resolve([]);
          }),
          setStatus: mock(() => Promise.resolve()),
          updateEnginePath: mock(() => Promise.resolve()),
        } as unknown as WeightIterationDeps["competitorsRepo"],
      });
      const service = createWeightIterationService(deps);

      const results = await service.iterateAll();

      expect(results).toHaveLength(2);
      const ids = results.map((r) => r.competitorId);
      expect(ids).toContain("wt-test");
      expect(ids).toContain("wt-pending");
    });
  });
});
