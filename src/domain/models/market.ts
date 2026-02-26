export type Event = {
  id: string;
  slug: string;
  title: string;
  startDate: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  markets: Market[];
};

export type Market = {
  id: string;
  conditionId: string;
  slug: string;
  question: string;
  outcomes: [string, string];
  outcomePrices: [string, string];
  tokenIds: [string, string];
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  liquidity: number;
  volume: number;
  gameId: string | null;
  sportsMarketType: string | null;
  line: number | null;
};
