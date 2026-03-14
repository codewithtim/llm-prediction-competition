import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createTwitterAdapter,
  formatTweet,
} from "../../../../../src/apis/notifications/adapters/twitter.ts";
import type { NotificationEvent } from "../../../../../src/domain/types/notification.ts";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("formatTweet", () => {
  it("formats bets_placed with fixture, side, price, stake, competitor", () => {
    const event: NotificationEvent = {
      type: "bets_placed",
      bets: [
        {
          competitorId: "wt-gpt",
          marketQuestion: "Will Arsenal win?",
          fixtureLabel: "Arsenal vs Chelsea",
          side: "YES",
          amount: 5,
          price: 0.65,
        },
      ],
    };

    const tweets = formatTweet(event);
    expect(tweets).toHaveLength(1);
    expect(tweets![0]).toContain("Arsenal vs Chelsea");
    expect(tweets![0]).toContain("Will Arsenal win?");
    expect(tweets![0]).toContain("YES");
    expect(tweets![0]).toContain("0.65");
    expect(tweets![0]).toContain("$5.00");
    expect(tweets![0]).toContain("wt-gpt");
  });

  it("formats bets_settled won with profit", () => {
    const event: NotificationEvent = {
      type: "bets_settled",
      bets: [
        {
          betId: "bet-1",
          competitorId: "wt-gpt",
          marketQuestion: "Will Arsenal win?",
          side: "YES",
          outcome: "won",
          profit: 2.69,
          amount: 5,
        },
      ],
    };

    const tweets = formatTweet(event);
    expect(tweets).toHaveLength(1);
    expect(tweets![0]).toContain("Bet won");
    expect(tweets![0]).toContain("Will Arsenal win?");
    expect(tweets![0]).toContain("$5.00 stake");
    expect(tweets![0]).toContain("+$2.69");
    expect(tweets![0]).toContain("wt-gpt");
  });

  it("formats bets_settled lost with loss amount", () => {
    const event: NotificationEvent = {
      type: "bets_settled",
      bets: [
        {
          betId: "bet-1",
          competitorId: "wt-gpt",
          marketQuestion: "Will Arsenal win?",
          side: "YES",
          outcome: "lost",
          profit: -5,
          amount: 5,
        },
      ],
    };

    const tweets = formatTweet(event);
    expect(tweets).toHaveLength(1);
    expect(tweets![0]).toContain("Bet lost");
    expect(tweets![0]).toContain("$5.00 stake");
    expect(tweets![0]).toContain("-$5.00");
  });

  it("formats weekly_summary with win rate, P&L, top competitor", () => {
    const event: NotificationEvent = {
      type: "weekly_summary",
      summary: {
        periodStart: "2026-03-07",
        periodEnd: "2026-03-14",
        totalBetsPlaced: 10,
        totalBetsSettled: 8,
        wins: 5,
        losses: 3,
        winRate: 0.625,
        totalStaked: 50,
        netPnl: 12.5,
        topCompetitor: { id: "wt-gpt", name: "GPT Model", pnl: 8.3 },
        upcomingFixtures: 6,
      },
    };

    const tweets = formatTweet(event);
    expect(tweets).toHaveLength(1);
    expect(tweets![0]).toContain("10 bets placed");
    expect(tweets![0]).toContain("5W - 3L");
    expect(tweets![0]).toContain("62.5%");
    expect(tweets![0]).toContain("+$12.50");
    expect(tweets![0]).toContain("GPT Model");
    expect(tweets![0]).toContain("6 fixtures ahead");
  });

  it("skips bets_failed — returns null", () => {
    const event: NotificationEvent = {
      type: "bets_failed",
      bets: [
        {
          competitorId: "wt-gpt",
          marketQuestion: "Will Arsenal win?",
          fixtureLabel: "Arsenal vs Chelsea",
          side: "YES",
          amount: 5,
          error: "Insufficient balance",
        },
      ],
    };

    expect(formatTweet(event)).toBeNull();
  });

  it("skips iteration_complete — returns null", () => {
    const event: NotificationEvent = {
      type: "iteration_complete",
      successes: [
        { competitorId: "wt-gpt", competitorName: "GPT", version: 3, model: "gpt-4o" },
      ],
      failures: [],
    };

    expect(formatTweet(event)).toBeNull();
  });

  it("produces one tweet per bet for batch events", () => {
    const event: NotificationEvent = {
      type: "bets_placed",
      bets: [
        {
          competitorId: "wt-gpt",
          marketQuestion: "Will Arsenal win?",
          fixtureLabel: "Arsenal vs Chelsea",
          side: "YES",
          amount: 5,
          price: 0.65,
        },
        {
          competitorId: "wt-claude",
          marketQuestion: "Will Liverpool win?",
          fixtureLabel: "Liverpool vs Man City",
          side: "NO",
          amount: 3,
          price: 0.4,
        },
        {
          competitorId: "wt-gemini",
          marketQuestion: "Will Spurs win?",
          fixtureLabel: "Spurs vs Brighton",
          side: "YES",
          amount: 2,
          price: 0.55,
        },
      ],
    };

    const tweets = formatTweet(event);
    expect(tweets).toHaveLength(3);
  });

  it("truncates tweets exceeding 280 characters", () => {
    const event: NotificationEvent = {
      type: "bets_placed",
      bets: [
        {
          competitorId: "very-long-competitor-name-that-takes-space",
          marketQuestion:
            "Will the team with a really long name that takes up way too many characters in the question win the match against the other team with an equally long name?",
          fixtureLabel:
            "Very Long Team Name United FC vs Another Very Long Team Name Athletic FC",
          side: "YES",
          amount: 5,
          price: 0.65,
        },
      ],
    };

    const tweets = formatTweet(event);
    expect(tweets).toHaveLength(1);
    expect(tweets![0]!.length).toBeLessThanOrEqual(280);
  });
});

describe("createTwitterAdapter", () => {
  it("no-ops when credentials are empty", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response("ok", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = createTwitterAdapter({});
    const event: NotificationEvent = {
      type: "bets_placed",
      bets: [
        {
          competitorId: "wt-gpt",
          marketQuestion: "Will Arsenal win?",
          fixtureLabel: "Arsenal vs Chelsea",
          side: "YES",
          amount: 5,
          price: 0.65,
        },
      ],
    };

    await adapter.send(event);
    expect(mockFetch).toHaveBeenCalledTimes(0);
  });

  it("sends one API call per tweet for batch events", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { id: "123" } }), { status: 201 })),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = createTwitterAdapter(
      {},
      {
        consumerKey: "ck",
        consumerSecret: "cs",
        accessToken: "at",
        accessTokenSecret: "ats",
      },
    );

    const event: NotificationEvent = {
      type: "bets_placed",
      bets: [
        {
          competitorId: "wt-gpt",
          marketQuestion: "Will Arsenal win?",
          fixtureLabel: "Arsenal vs Chelsea",
          side: "YES",
          amount: 5,
          price: 0.65,
        },
        {
          competitorId: "wt-claude",
          marketQuestion: "Will Liverpool win?",
          fixtureLabel: "Liverpool vs Man City",
          side: "NO",
          amount: 3,
          price: 0.4,
        },
      ],
    };

    await adapter.send(event);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("includes OAuth Authorization header", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { id: "123" } }), { status: 201 })),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = createTwitterAdapter(
      {},
      {
        consumerKey: "test-ck",
        consumerSecret: "test-cs",
        accessToken: "test-at",
        accessTokenSecret: "test-ats",
      },
    );

    const event: NotificationEvent = {
      type: "bets_settled",
      bets: [
        {
          betId: "bet-1",
          competitorId: "wt-gpt",
          marketQuestion: "Will Arsenal win?",
          side: "YES",
          outcome: "won",
          profit: 2.69,
          amount: 5,
        },
      ],
    };

    await adapter.send(event);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.twitter.com/2/tweets");
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toStartWith("OAuth ");
    expect(headers.Authorization).toContain("oauth_consumer_key");
    expect(headers.Authorization).toContain("oauth_signature");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
