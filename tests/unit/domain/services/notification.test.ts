import { describe, expect, it, mock } from "bun:test";
import type { NotificationChannelsRepo } from "../../../../src/database/repositories/notification-channels";
import { createNotificationService } from "../../../../src/domain/services/notification";
import type { AdapterFactory, NotificationEvent } from "../../../../src/domain/types/notification";

const testEvent: NotificationEvent = {
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

function mockChannelsRepo(
  channels: Array<{
    id: number;
    name: string;
    type: string;
    config: Record<string, string>;
    enabled: boolean;
    eventFilter?: string[] | null;
  }>,
): NotificationChannelsRepo {
  return {
    findEnabled: mock(() => Promise.resolve(channels.filter((c) => c.enabled))),
    findAll: mock(() => Promise.resolve(channels)),
    findById: mock(() => Promise.resolve(undefined)),
    create: mock(() => Promise.resolve()),
    update: mock(() => Promise.resolve()),
  } as unknown as NotificationChannelsRepo;
}

describe("createNotificationService", () => {
  it("dispatches event to all enabled channels", async () => {
    const sendMock = mock(() => Promise.resolve());
    const factory: AdapterFactory = () => ({ send: sendMock });
    const factories = new Map([["discord", factory]]);

    const repo = mockChannelsRepo([
      { id: 1, name: "Discord 1", type: "discord", config: { webhookUrl: "https://a" }, enabled: true },
      { id: 2, name: "Discord 2", type: "discord", config: { webhookUrl: "https://b" }, enabled: true },
    ]);

    const service = createNotificationService({ channelsRepo: repo, adapterFactories: factories });
    await service.notify(testEvent);

    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("skips channels with unknown adapter type", async () => {
    const sendMock = mock(() => Promise.resolve());
    const factory: AdapterFactory = () => ({ send: sendMock });
    const factories = new Map([["discord", factory]]);

    const repo = mockChannelsRepo([
      { id: 1, name: "Unknown", type: "twitter", config: {}, enabled: true },
      { id: 2, name: "Discord", type: "discord", config: { webhookUrl: "https://a" }, enabled: true },
    ]);

    const service = createNotificationService({ channelsRepo: repo, adapterFactories: factories });
    await service.notify(testEvent);

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("one failing channel doesn't prevent others from receiving", async () => {
    const sendMock1 = mock(() => Promise.reject(new Error("Webhook down")));
    const sendMock2 = mock(() => Promise.resolve());
    let callCount = 0;
    const factory: AdapterFactory = () => ({
      send: callCount++ === 0 ? sendMock1 : sendMock2,
    });
    const factories = new Map([["discord", factory]]);

    const repo = mockChannelsRepo([
      { id: 1, name: "Failing", type: "discord", config: { webhookUrl: "https://a" }, enabled: true },
      { id: 2, name: "Working", type: "discord", config: { webhookUrl: "https://b" }, enabled: true },
    ]);

    const service = createNotificationService({ channelsRepo: repo, adapterFactories: factories });
    await service.notify(testEvent);

    expect(sendMock1).toHaveBeenCalledTimes(1);
    expect(sendMock2).toHaveBeenCalledTimes(1);
  });

  it("filters events by channel eventFilter", async () => {
    const sendMock = mock(() => Promise.resolve());
    const factory: AdapterFactory = () => ({ send: sendMock });
    const factories = new Map([["discord", factory]]);

    const repo = mockChannelsRepo([
      {
        id: 1,
        name: "Summary Only",
        type: "discord",
        config: { webhookUrl: "https://a" },
        enabled: true,
        eventFilter: ["weekly_summary"],
      },
    ]);

    const service = createNotificationService({ channelsRepo: repo, adapterFactories: factories });
    await service.notify(testEvent); // bets_placed — should be filtered out

    expect(sendMock).toHaveBeenCalledTimes(0);
  });

  it("null eventFilter receives all events", async () => {
    const sendMock = mock(() => Promise.resolve());
    const factory: AdapterFactory = () => ({ send: sendMock });
    const factories = new Map([["discord", factory]]);

    const repo = mockChannelsRepo([
      {
        id: 1,
        name: "All Events",
        type: "discord",
        config: { webhookUrl: "https://a" },
        enabled: true,
        eventFilter: null,
      },
    ]);

    const service = createNotificationService({ channelsRepo: repo, adapterFactories: factories });
    await service.notify(testEvent);

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("multiple channels with different filters only receive matching events", async () => {
    const sendMock1 = mock(() => Promise.resolve());
    const sendMock2 = mock(() => Promise.resolve());
    let callIdx = 0;
    const factory: AdapterFactory = () => ({
      send: callIdx++ === 0 ? sendMock1 : sendMock2,
    });
    const factories = new Map([["discord", factory]]);

    const repo = mockChannelsRepo([
      {
        id: 1,
        name: "Bets Only",
        type: "discord",
        config: { webhookUrl: "https://a" },
        enabled: true,
        eventFilter: ["bets_placed"],
      },
      {
        id: 2,
        name: "Summary Only",
        type: "discord",
        config: { webhookUrl: "https://b" },
        enabled: true,
        eventFilter: ["weekly_summary"],
      },
    ]);

    const service = createNotificationService({ channelsRepo: repo, adapterFactories: factories });
    await service.notify(testEvent); // bets_placed

    expect(sendMock1).toHaveBeenCalledTimes(1);
    expect(sendMock2).toHaveBeenCalledTimes(0);
  });

  it("works when no channels are configured (no-op)", async () => {
    const factories = new Map<string, AdapterFactory>();
    const repo = mockChannelsRepo([]);

    const service = createNotificationService({ channelsRepo: repo, adapterFactories: factories });
    await expect(service.notify(testEvent)).resolves.toBeUndefined();
  });
});
