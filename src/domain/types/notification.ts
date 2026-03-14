export type PlacedBetNotification = {
  competitorId: string;
  marketQuestion: string;
  fixtureLabel: string;
  side: "YES" | "NO";
  amount: number;
  price: number;
};

export type SettledBetNotification = {
  betId: string;
  competitorId: string;
  marketQuestion: string;
  side: "YES" | "NO";
  outcome: "won" | "lost";
  profit: number;
  amount: number;
};

export type IterationNotification = {
  competitorId: string;
  competitorName: string;
  version: number;
  model: string;
};

export type FailedBetNotification = {
  competitorId: string;
  marketQuestion: string;
  fixtureLabel: string;
  side: "YES" | "NO";
  amount: number;
  error: string;
};

export type IterationFailureNotification = {
  competitorId: string;
  competitorName: string;
  error: string;
};

export type WeeklySummaryNotification = {
  periodStart: string;
  periodEnd: string;
  totalBetsPlaced: number;
  totalBetsSettled: number;
  wins: number;
  losses: number;
  winRate: number;
  totalStaked: number;
  netPnl: number;
  topCompetitor: { id: string; name: string; pnl: number } | null;
  upcomingFixtures: number;
};

export type NotificationEvent =
  | { type: "bets_placed"; bets: PlacedBetNotification[] }
  | { type: "bets_failed"; bets: FailedBetNotification[] }
  | { type: "bets_settled"; bets: SettledBetNotification[] }
  | {
      type: "iteration_complete";
      successes: IterationNotification[];
      failures: IterationFailureNotification[];
    }
  | { type: "weekly_summary"; summary: WeeklySummaryNotification };

export type NotificationAdapter = {
  send(event: NotificationEvent): Promise<void>;
};

export type NotificationEventType = NotificationEvent["type"];

export type AdapterFactory = (config: Record<string, string>) => NotificationAdapter;
