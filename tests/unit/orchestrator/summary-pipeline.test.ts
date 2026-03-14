import { describe, expect, it, mock } from "bun:test";
import { createSummaryPipeline } from "../../../src/orchestrator/summary-pipeline.ts";
import type { NotificationEvent } from "../../../src/domain/types/notification.ts";

function makeBetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bet-1",
    orderId: "order-1",
    marketId: "market-1",
    fixtureId: 1001,
    competitorId: "claude-1",
    tokenId: "t1",
    side: "YES" as const,
    amount: 10,
    price: 0.65,
    shares: 15.38,
    status: "pending" as const,
    placedAt: new Date(),
    settledAt: null,
    profit: null,
    errorMessage: null,
    errorCategory: null,
    attempts: 0,
    lastAttemptAt: null,
    ...overrides,
  };
}

describe("createSummaryPipeline", () => {
  it("builds correct summary from bet data", async () => {
    const notifyMock = mock(() => Promise.resolve());

    const pipeline = createSummaryPipeline({
      betsRepo: {
        findPlacedInRange: mock(() =>
          Promise.resolve([
            makeBetRow({ id: "b1", amount: 10 }),
            makeBetRow({ id: "b2", amount: 5 }),
          ]),
        ),
        findSettledInRange: mock(() =>
          Promise.resolve([
            makeBetRow({ id: "b1", amount: 10, status: "settled_won", profit: 5, settledAt: new Date() }),
            makeBetRow({ id: "b2", amount: 5, status: "settled_lost", profit: -5, settledAt: new Date() }),
          ]),
        ),
      },
      fixturesRepo: {
        findScheduledUpcoming: mock(() =>
          Promise.resolve([{ id: 1 }, { id: 2 }, { id: 3 }]),
        ),
      },
      competitorsRepo: {
        findAll: mock(() =>
          Promise.resolve([
            { id: "claude-1", name: "Claude", model: "claude-sonnet-4", status: "active" },
          ]),
        ),
      },
      notificationService: { notify: notifyMock },
    });

    await pipeline.run();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    const event = (notifyMock.mock.calls[0] as unknown as [NotificationEvent])[0];
    expect(event.type).toBe("weekly_summary");
    if (event.type === "weekly_summary") {
      expect(event.summary.totalBetsPlaced).toBe(2);
      expect(event.summary.totalBetsSettled).toBe(2);
      expect(event.summary.wins).toBe(1);
      expect(event.summary.losses).toBe(1);
      expect(event.summary.winRate).toBe(0.5);
      expect(event.summary.totalStaked).toBe(15);
      expect(event.summary.netPnl).toBe(0);
      expect(event.summary.upcomingFixtures).toBe(3);
    }
  });

  it("handles empty period with zeroed summary", async () => {
    const notifyMock = mock(() => Promise.resolve());

    const pipeline = createSummaryPipeline({
      betsRepo: {
        findPlacedInRange: mock(() => Promise.resolve([])),
        findSettledInRange: mock(() => Promise.resolve([])),
      },
      fixturesRepo: {
        findScheduledUpcoming: mock(() => Promise.resolve([])),
      },
      competitorsRepo: {
        findAll: mock(() => Promise.resolve([])),
      },
      notificationService: { notify: notifyMock },
    });

    await pipeline.run();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    const event = (notifyMock.mock.calls[0] as unknown as [NotificationEvent])[0];
    if (event.type === "weekly_summary") {
      expect(event.summary.totalBetsPlaced).toBe(0);
      expect(event.summary.wins).toBe(0);
      expect(event.summary.losses).toBe(0);
      expect(event.summary.winRate).toBe(0);
      expect(event.summary.netPnl).toBe(0);
      expect(event.summary.topCompetitor).toBeNull();
    }
  });

  it("identifies top competitor by P&L", async () => {
    const notifyMock = mock(() => Promise.resolve());

    const pipeline = createSummaryPipeline({
      betsRepo: {
        findPlacedInRange: mock(() => Promise.resolve([])),
        findSettledInRange: mock(() =>
          Promise.resolve([
            makeBetRow({ id: "b1", competitorId: "claude-1", status: "settled_won", profit: 10, settledAt: new Date() }),
            makeBetRow({ id: "b2", competitorId: "gpt-1", status: "settled_won", profit: 20, settledAt: new Date() }),
            makeBetRow({ id: "b3", competitorId: "claude-1", status: "settled_lost", profit: -3, settledAt: new Date() }),
          ]),
        ),
      },
      fixturesRepo: {
        findScheduledUpcoming: mock(() => Promise.resolve([])),
      },
      competitorsRepo: {
        findAll: mock(() =>
          Promise.resolve([
            { id: "claude-1", name: "Claude", model: "claude-sonnet-4", status: "active" },
            { id: "gpt-1", name: "GPT", model: "gpt-4o", status: "active" },
          ]),
        ),
      },
      notificationService: { notify: notifyMock },
    });

    await pipeline.run();

    const event = (notifyMock.mock.calls[0] as unknown as [NotificationEvent])[0];
    if (event.type === "weekly_summary") {
      expect(event.summary.topCompetitor).not.toBeNull();
      expect(event.summary.topCompetitor!.id).toBe("gpt-1");
      expect(event.summary.topCompetitor!.name).toBe("GPT");
      expect(event.summary.topCompetitor!.pnl).toBe(20);
    }
  });
});
