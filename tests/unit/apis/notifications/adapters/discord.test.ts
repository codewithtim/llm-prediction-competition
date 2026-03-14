import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createDiscordAdapter } from "../../../../../src/apis/notifications/adapters/discord.ts";
import type { NotificationEvent } from "../../../../../src/domain/types/notification.ts";

const WEBHOOK_URL = "https://discord.com/api/webhooks/123/abc";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createDiscordAdapter", () => {
  it("throws on missing webhookUrl in config", () => {
    expect(() => createDiscordAdapter({})).toThrow("Discord adapter requires webhookUrl in config");
  });

  it("sends correct HTTP payload for bets_placed event", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response("ok", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = createDiscordAdapter({ webhookUrl: WEBHOOK_URL });
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

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);
    expect(opts.method).toBe("POST");
    expect(opts.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(opts.body as string);
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].title).toBe("Bets Placed");
    expect(body.embeds[0].color).toBe(0x00c853);
    expect(body.embeds[0].fields).toHaveLength(1);
    expect(body.embeds[0].fields[0].name).toContain("Arsenal vs Chelsea");
    expect(body.embeds[0].fields[0].value).toContain("YES");
    expect(body.embeds[0].fields[0].value).toContain("$0.65");
    expect(body.embeds[0].fields[0].value).toContain("$5.00");
  });

  it("formats bets_settled with green color for positive P&L", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response("ok", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = createDiscordAdapter({ webhookUrl: WEBHOOK_URL });
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

    const body = JSON.parse((mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.embeds[0].color).toBe(0x00c853);
    expect(body.embeds[0].fields[0].value).toContain("Won");
    expect(body.embeds[0].fields[0].value).toContain("$5.00 stake");
    expect(body.embeds[0].footer.text).toContain("+$2.69");
  });

  it("formats bets_settled with red color for negative P&L", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response("ok", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = createDiscordAdapter({ webhookUrl: WEBHOOK_URL });
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

    await adapter.send(event);

    const body = JSON.parse((mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.embeds[0].color).toBe(0xf44336);
    expect(body.embeds[0].footer.text).toContain("$-5.00");
  });

  it("formats bets_failed event with red color and error details", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response("ok", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = createDiscordAdapter({ webhookUrl: WEBHOOK_URL });
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

    await adapter.send(event);

    const body = JSON.parse((mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.embeds[0].title).toBe("Bets Failed");
    expect(body.embeds[0].color).toBe(0xf44336);
    expect(body.embeds[0].fields).toHaveLength(1);
    expect(body.embeds[0].fields[0].name).toContain("Arsenal vs Chelsea");
    expect(body.embeds[0].fields[0].value).toContain("Insufficient balance");
    expect(body.embeds[0].fields[0].value).toContain("$5.00");
    expect(body.embeds[0].footer.text).toBe("1 bet failed");
  });

  it("formats iteration_complete event with successes and failures", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response("ok", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = createDiscordAdapter({ webhookUrl: WEBHOOK_URL });
    const event: NotificationEvent = {
      type: "iteration_complete",
      successes: [
        { competitorId: "wt-gpt", competitorName: "GPT Competitor", version: 3, model: "gpt-4o" },
      ],
      failures: [
        { competitorId: "wt-claude", competitorName: "Claude Competitor", error: "LLM timeout" },
      ],
    };

    await adapter.send(event);

    const body = JSON.parse((mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.embeds[0].title).toBe("Model Iteration");
    expect(body.embeds[0].color).toBe(0xf44336);
    expect(body.embeds[0].fields).toHaveLength(2);
    expect(body.embeds[0].fields[0].name).toBe("GPT Competitor");
    expect(body.embeds[0].fields[0].value).toContain("v3");
    expect(body.embeds[0].fields[1].name).toContain("FAILED");
    expect(body.embeds[0].footer.text).toBe("1 succeeded, 1 failed");
  });

  it("formats weekly_summary embed with correct fields and colors", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response("ok", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = createDiscordAdapter({ webhookUrl: WEBHOOK_URL });
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

    await adapter.send(event);

    const body = JSON.parse((mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.embeds[0].title).toBe("Weekly Summary");
    expect(body.embeds[0].color).toBe(0x00c853); // green for positive P&L
    const fieldNames = body.embeds[0].fields.map((f: { name: string }) => f.name);
    expect(fieldNames).toContain("Period");
    expect(fieldNames).toContain("Bets Placed");
    expect(fieldNames).toContain("Win Rate");
    expect(fieldNames).toContain("Net P&L");
    expect(fieldNames).toContain("Top Competitor");
    expect(body.embeds[0].footer.text).toContain("Weekly Report");
  });

  it("formats weekly_summary with red color for negative P&L", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response("ok", { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = createDiscordAdapter({ webhookUrl: WEBHOOK_URL });
    const event: NotificationEvent = {
      type: "weekly_summary",
      summary: {
        periodStart: "2026-03-07",
        periodEnd: "2026-03-14",
        totalBetsPlaced: 5,
        totalBetsSettled: 5,
        wins: 1,
        losses: 4,
        winRate: 0.2,
        totalStaked: 50,
        netPnl: -20,
        topCompetitor: null,
        upcomingFixtures: 3,
      },
    };

    await adapter.send(event);

    const body = JSON.parse((mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.embeds[0].color).toBe(0xf44336); // red for negative P&L
  });

  it("handles HTTP errors gracefully (no throw)", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response("rate limited", { status: 429 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = createDiscordAdapter({ webhookUrl: WEBHOOK_URL });
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

    await expect(adapter.send(event)).resolves.toBeUndefined();
  });

  it("handles network errors gracefully (no throw)", async () => {
    const mockFetch = mock(() => Promise.reject(new Error("Network error")));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = createDiscordAdapter({ webhookUrl: WEBHOOK_URL });
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

    await expect(adapter.send(event)).resolves.toBeUndefined();
  });
});
