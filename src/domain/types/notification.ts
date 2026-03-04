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

export type NotificationEvent =
  | { type: "bets_placed"; bets: PlacedBetNotification[] }
  | { type: "bets_failed"; bets: FailedBetNotification[] }
  | { type: "bets_settled"; bets: SettledBetNotification[] }
  | {
      type: "iteration_complete";
      successes: IterationNotification[];
      failures: IterationFailureNotification[];
    };

export type NotificationAdapter = {
  send(event: NotificationEvent): Promise<void>;
};

export type AdapterFactory = (config: Record<string, string>) => NotificationAdapter;
