export type PerformanceStatsDTO = {
  totalBets: number;
  wins: number;
  losses: number;
  pending: number;
  failed: number;
  lockedAmount: number;
  totalStaked: number;
  totalReturned: number;
  profitLoss: number;
  accuracy: number;
  roi: number;
};

export type CompetitorSummary = {
  id: string;
  name: string;
  model: string;
  status: string;
  type: string;
  hasWallet: boolean;
  walletAddress: string | null;
  createdAt: string;
  stats: PerformanceStatsDTO;
};

export type CompetitorDetailResponse = {
  id: string;
  name: string;
  model: string;
  status: string;
  type: string;
  hasWallet: boolean;
  walletAddress: string | null;
  createdAt: string;
  stats: PerformanceStatsDTO;
  versions: VersionSummary[];
  recentBets: BetSummary[];
  recentPredictions: PredictionSummary[];
};

export type VersionSummary = {
  id: number;
  version: number;
  model: string;
  enginePath: string;
  performanceSnapshot: {
    totalBets: number;
    wins: number;
    losses: number;
    accuracy: number;
    roi: number;
    profitLoss: number;
  } | null;
  overallAssessment: string | null;
  generatedAt: string;
};

export type ChangelogEntryDTO = {
  parameter: string;
  previous: number;
  new: number;
  reason: string;
};

export type VersionDetailResponse = {
  id: number;
  version: number;
  model: string;
  enginePath: string;
  generatedAt: string;
  performanceSnapshot: {
    totalBets: number;
    wins: number;
    losses: number;
    accuracy: number;
    roi: number;
    profitLoss: number;
  } | null;
  weights: Record<string, number | Record<string, number>>;
  changelog: ChangelogEntryDTO[];
  overallAssessment: string | null;
};

export type FixtureSummary = {
  id: number;
  leagueName: string;
  leagueCountry: string;
  homeTeamName: string;
  awayTeamName: string;
  date: string;
  venue: string | null;
  status: string;
  marketCount: number;
};

export type FixtureDetailResponse = {
  id: number;
  leagueId: number;
  leagueName: string;
  leagueCountry: string;
  leagueSeason: number;
  homeTeamId: number;
  homeTeamName: string;
  homeTeamLogo: string | null;
  awayTeamId: number;
  awayTeamName: string;
  awayTeamLogo: string | null;
  date: string;
  venue: string | null;
  status: string;
  markets: MarketSummary[];
  predictions: PredictionSummary[];
};

export type MarketSummary = {
  id: string;
  polymarketUrl: string | null;
  question: string;
  outcomes: [string, string];
  outcomePrices: [string, string];
  active: boolean;
  closed: boolean;
  liquidity: number;
  volume: number;
  fixtureId: number | null;
  fixtureSummary: string | null;
  sportsMarketType: string | null;
  status: string;
};

export type BetSummary = {
  id: string;
  competitorId: string;
  competitorName: string;
  marketId: string;
  marketQuestion: string;
  polymarketUrl: string | null;
  fixtureId: number;
  side: "YES" | "NO";
  amount: number;
  price: number;
  shares: number;
  status: string;
  placedAt: string;
  settledAt: string | null;
  profit: number | null;
  confidence: number | null;
  errorMessage: string | null;
  errorCategory: string | null;
  attempts: number;
};

export type BetDetailResponse = BetSummary & {
  fixtureSummary: string | null;
  fixtureDate: string | null;
  fixtureStatus: string | null;
  marketOutcomes: [string, string] | null;
  marketOutcomePrices: [string, string] | null;
  marketActive: boolean | null;
  marketClosed: boolean | null;
  reasoning: ReasoningDTO | null;
  orderId: string | null;
  lastAttemptAt: string | null;
};

export type ReasoningSectionDTO = {
  label: string;
  content: string;
  data?: Record<string, unknown>;
};

export type ReasoningDTO = {
  summary: string;
  sections: ReasoningSectionDTO[];
};

export type PredictionSummary = {
  id: number;
  competitorId: string;
  competitorName: string;
  marketId: string;
  marketQuestion: string;
  fixtureId: number;
  side: "YES" | "NO";
  confidence: number;
  stake: number;
  reasoning: ReasoningDTO;
  createdAt: string;
};

export type LeaderboardEntry = {
  competitor: CompetitorSummary;
  rank: number;
};

export type DashboardResponse = {
  totalCompetitors: number;
  activeCompetitors: number;
  totalFixtures: number;
  totalMarkets: number;
  activeMarkets: number;
  totalBets: number;
  pendingBets: number;
  failedBets: number;
  lockedAmount: number;
  totalProfitLoss: number;
  overallAccuracy: number;
  leaderboard: LeaderboardEntry[];
  recentBets: BetSummary[];
};
