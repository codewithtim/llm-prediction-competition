export type GammaSport = {
  id: number;
  sport: string;
  image: string;
  resolution: string;
  ordering: string;
  tags: string;
  series: string;
  createdAt: string;
};

export type GammaMarket = {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string;
  outcomePrices: string;
  clobTokenIds: string;
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  liquidity: string;
  liquidityNum: number;
  volume: string;
  volumeNum: number;
  gameId: string | null;
  sportsMarketType: string | null;
  bestBid: number;
  bestAsk: number;
  lastTradePrice: number;
  orderPriceMinTickSize: number;
  orderMinSize: number;
};

export type GammaEvent = {
  id: string;
  title: string;
  slug: string;
  startDate: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  seriesSlug: string;
  eventDate: string;
  startTime: string;
  score: string;
  elapsed: string;
  period: string;
  gameId: number | string | null;
  markets: GammaMarket[];
};

export type GammaTag = {
  id: number;
  label: string;
  slug: string;
};

export type GammaEventParams = {
  tag_id?: number;
  active?: boolean;
  closed?: boolean;
  limit?: number;
  offset?: number;
  order?: string;
  ascending?: boolean;
  start_date_min?: string;
  start_date_max?: string;
  end_date_min?: string;
  end_date_max?: string;
};
