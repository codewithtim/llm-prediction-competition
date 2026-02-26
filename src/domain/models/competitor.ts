export type Competitor = {
  id: string;
  name: string;
  model: string;
  enginePath: string;
  active: boolean;
  createdAt: string;
};

export type PerformanceStats = {
  competitorId: string;
  totalBets: number;
  wins: number;
  losses: number;
  pending: number;
  totalStaked: number;
  totalReturned: number;
  profitLoss: number;
  accuracy: number;
  roi: number;
};
