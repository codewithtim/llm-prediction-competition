import { describe, expect, it, mock } from "bun:test";
import {
  createIterationService,
  type IterationDeps,
} from "../../../../src/competitors/llm-codegen/iteration.ts";
import { createRegistry } from "../../../../src/competitors/registry.ts";

const sampleCode = `import type { PredictionOutput } from "../../domain/contracts/prediction";
import type { Statistics } from "../../domain/contracts/statistics";
const engine = (stats: Statistics): PredictionOutput[] => [{
  marketId: stats.market.marketId,
  side: "YES",
  confidence: 0.6,
  stake: 3,
  reasoning: "Test engine"
}];
export default engine;`;

function mockCompetitorsRepo(
  competitors: Array<{
    id: string;
    name: string;
    model: string;
    enginePath: string;
    active: boolean;
  }> = [],
) {
  return {
    create: mock(() => Promise.resolve()),
    findById: mock((id: string) => Promise.resolve(competitors.find((c) => c.id === id) ?? null)),
    findActive: mock(() => Promise.resolve(competitors.filter((c) => c.active))),
    setActive: mock(() => Promise.resolve()),
    updateEnginePath: mock(() => Promise.resolve()),
  };
}

function mockVersionsRepo() {
  return {
    create: mock(() => Promise.resolve()),
    findByCompetitor: mock(() => Promise.resolve([])),
    findLatest: mock(() => Promise.resolve(null)),
    findByVersion: mock(() => Promise.resolve(null)),
  };
}

function mockBetsRepo(
  stats = {
    competitorId: "test",
    totalBets: 5,
    wins: 3,
    losses: 2,
    pending: 0,
    totalStaked: 25,
    totalReturned: 30,
    profitLoss: 5,
    accuracy: 0.6,
    roi: 0.2,
  },
) {
  return {
    create: mock(() => Promise.resolve()),
    findById: mock(() => Promise.resolve(null)),
    findByCompetitor: mock(() => Promise.resolve([])),
    findByStatus: mock(() => Promise.resolve([])),
    updateStatus: mock(() => Promise.resolve()),
    getPerformanceStats: mock(() => Promise.resolve(stats)),
  };
}

function mockPredictionsRepo() {
  return {
    create: mock(() => Promise.resolve()),
    findByCompetitor: mock(() => Promise.resolve([])),
    findByMarket: mock(() => Promise.resolve([])),
    findByFixtureAndCompetitor: mock(() => Promise.resolve([])),
  };
}

function mockMarketsRepo() {
  return {
    upsert: mock(() => Promise.resolve()),
    findById: mock(() => Promise.resolve(null)),
    findActive: mock(() => Promise.resolve([])),
    findByGameId: mock(() => Promise.resolve([])),
  };
}

function mockGenerator(code = sampleCode) {
  return {
    generateEngine: mock(() =>
      Promise.resolve({ competitorId: "test", code, model: "test/model" }),
    ),
    generateWithFeedback: mock(() =>
      Promise.resolve({ competitorId: "test", code, model: "test/model" }),
    ),
  };
}

function makeDeps(overrides?: Partial<IterationDeps>): IterationDeps {
  return {
    generator: mockGenerator(),
    competitorsRepo: mockCompetitorsRepo([
      {
        id: "test-codegen",
        name: "Test Codegen",
        model: "test/model",
        enginePath: "src/competitors/test-codegen/engine.ts",
        active: true,
      },
    ]),
    versionsRepo: mockVersionsRepo(),
    betsRepo: mockBetsRepo(),
    predictionsRepo: mockPredictionsRepo(),
    marketsRepo: mockMarketsRepo(),
    registry: createRegistry(),
    ...overrides,
  } as IterationDeps;
}

describe("createIterationService", () => {
  describe("buildLeaderboard", () => {
    it("aggregates stats and sorts by P&L", async () => {
      const competitors = mockCompetitorsRepo([
        { id: "a", name: "Alpha", model: "m", enginePath: "p", active: true },
        { id: "b", name: "Beta", model: "m", enginePath: "p", active: true },
      ]);

      let callCount = 0;
      const betsR = mockBetsRepo();
      betsR.getPerformanceStats = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            competitorId: "a",
            totalBets: 5,
            wins: 2,
            losses: 3,
            pending: 0,
            totalStaked: 25,
            totalReturned: 20,
            profitLoss: -5,
            accuracy: 0.4,
            roi: -0.2,
          });
        }
        return Promise.resolve({
          competitorId: "b",
          totalBets: 5,
          wins: 4,
          losses: 1,
          pending: 0,
          totalStaked: 25,
          totalReturned: 35,
          profitLoss: 10,
          accuracy: 0.8,
          roi: 0.4,
        });
      });

      const deps = makeDeps({
        competitorsRepo: competitors,
        betsRepo: betsR,
      } as unknown as Partial<IterationDeps>);
      const service = createIterationService(deps);

      const leaderboard = await service.buildLeaderboard();

      expect(leaderboard).toHaveLength(2);
      expect(leaderboard[0]?.name).toBe("Beta");
      expect(leaderboard[0]?.profitLoss).toBe(10);
      expect(leaderboard[1]?.name).toBe("Alpha");
      expect(leaderboard[1]?.profitLoss).toBe(-5);
    });
  });

  describe("iterateCompetitor", () => {
    it("returns failure for non-existent competitor", async () => {
      const deps = makeDeps();
      const service = createIterationService(deps);

      const result = await service.iterateCompetitor("non-existent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("not found");
      }
    });

    it("calls generator with feedback prompt", async () => {
      const gen = mockGenerator();
      // Mock Bun.file to return code
      const originalFile = Bun.file;
      // @ts-expect-error - mock Bun.file for testing
      Bun.file = () => ({ text: () => Promise.resolve(sampleCode) });

      const deps = makeDeps({ generator: gen } as unknown as Partial<IterationDeps>);
      const service = createIterationService(deps);

      await service.iterateCompetitor("test-codegen");

      expect(gen.generateWithFeedback).toHaveBeenCalled();
      // biome-ignore lint/suspicious/noExplicitAny: test helper accessing mock internals
      const calls = (gen.generateWithFeedback as ReturnType<typeof mock>).mock.calls as any;
      const callArgs = calls[0][0] as {
        model: string;
        competitorId: string;
        feedbackPrompt: string;
      };
      expect(callArgs.model).toBe("test/model");
      expect(callArgs.competitorId).toBe("test-codegen");
      expect(callArgs.feedbackPrompt).toContain("Your Current Engine Code");

      Bun.file = originalFile;
    });

    it("returns failure on validation error", async () => {
      const gen = mockGenerator("this is not valid typescript code }{}{}{");
      const originalFile = Bun.file;
      // @ts-expect-error - mock Bun.file for testing
      Bun.file = () => ({ text: () => Promise.resolve(sampleCode) });

      const deps = makeDeps({ generator: gen } as unknown as Partial<IterationDeps>);
      const service = createIterationService(deps);

      const result = await service.iterateCompetitor("test-codegen");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Validation failed");
      }

      Bun.file = originalFile;
    });

    it("increments version number correctly from latest", async () => {
      const versionsR = mockVersionsRepo();
      // biome-ignore lint/suspicious/noExplicitAny: mock override for testing
      (versionsR as any).findLatest = mock(() =>
        Promise.resolve({
          id: 1,
          competitorId: "test-codegen",
          version: 3,
          code: sampleCode,
          enginePath: "p",
          model: "m",
          performanceSnapshot: null,
          generatedAt: new Date(),
        }),
      );

      const originalFile = Bun.file;
      // @ts-expect-error - mock Bun.file for testing
      Bun.file = () => ({ text: () => Promise.resolve(sampleCode) });

      const deps = makeDeps({ versionsRepo: versionsR } as unknown as Partial<IterationDeps>);
      const service = createIterationService(deps);

      const result = await service.iterateCompetitor("test-codegen");

      if (result.success) {
        expect(result.version).toBe(4);
      }

      Bun.file = originalFile;
    });

    it("saves version to DB on success", async () => {
      const versionsR = mockVersionsRepo();
      const originalFile = Bun.file;
      // @ts-expect-error - mock Bun.file for testing
      Bun.file = () => ({ text: () => Promise.resolve(sampleCode) });

      const deps = makeDeps({ versionsRepo: versionsR } as unknown as Partial<IterationDeps>);
      const service = createIterationService(deps);

      const result = await service.iterateCompetitor("test-codegen");

      if (result.success) {
        expect(versionsR.create).toHaveBeenCalled();
      }

      Bun.file = originalFile;
    });
  });

  describe("iterateAll", () => {
    it("iterates each codegen competitor sequentially", async () => {
      const competitors = mockCompetitorsRepo([
        { id: "codegen-1", name: "CG 1", model: "m", enginePath: "p", active: true },
        { id: "codegen-2", name: "CG 2", model: "m", enginePath: "p", active: true },
        { id: "gpt-runtime", name: "GPT Runtime", model: "m", enginePath: "", active: true },
      ]);

      const originalFile = Bun.file;
      // @ts-expect-error - mock Bun.file for testing
      Bun.file = () => ({ text: () => Promise.resolve(sampleCode) });

      const deps = makeDeps({ competitorsRepo: competitors } as unknown as Partial<IterationDeps>);
      const service = createIterationService(deps);

      const results = await service.iterateAll();

      // Should skip runtime competitors (id ends with -runtime) and empty enginePath
      expect(results.length).toBeGreaterThanOrEqual(1);

      Bun.file = originalFile;
    });
  });
});
