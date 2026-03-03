import type {
  BetSummary,
  CompetitorDetailResponse,
  CompetitorSummary,
  DashboardResponse,
  FixtureDetailResponse,
  FixtureSummary,
  MarketSummary,
  PredictionSummary,
} from "@shared/api-types";
import { useQuery } from "@tanstack/react-query";

const BASE = "/api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export function useDashboard() {
  return useQuery<DashboardResponse>({
    queryKey: ["dashboard"],
    queryFn: () => fetchJson("/dashboard"),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useCompetitors(status?: string) {
  return useQuery<CompetitorSummary[]>({
    queryKey: ["competitors", status],
    queryFn: () => fetchJson(`/competitors${status ? `?status=${status}` : ""}`),
  });
}

export function useCompetitor(id: string) {
  return useQuery<CompetitorDetailResponse>({
    queryKey: ["competitor", id],
    queryFn: () => fetchJson(`/competitors/${id}`),
  });
}

export function useFixtures(status?: string) {
  return useQuery<FixtureSummary[]>({
    queryKey: ["fixtures", status],
    queryFn: () => fetchJson(`/fixtures${status ? `?status=${status}` : ""}`),
  });
}

export function useFixture(id: number) {
  return useQuery<FixtureDetailResponse>({
    queryKey: ["fixture", id],
    queryFn: () => fetchJson(`/fixtures/${id}`),
  });
}

export function useMarkets(filters?: { active?: string; closed?: string }) {
  const params = new URLSearchParams();
  if (filters?.active !== undefined) params.set("active", filters.active);
  if (filters?.closed !== undefined) params.set("closed", filters.closed);
  const qs = params.toString();
  return useQuery<MarketSummary[]>({
    queryKey: ["markets", filters],
    queryFn: () => fetchJson(`/markets${qs ? `?${qs}` : ""}`),
  });
}

export function useBets(filters?: {
  status?: string;
  competitorId?: string;
  errorCategory?: string;
}) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.competitorId) params.set("competitorId", filters.competitorId);
  if (filters?.errorCategory) params.set("errorCategory", filters.errorCategory);
  const qs = params.toString();
  return useQuery<BetSummary[]>({
    queryKey: ["bets", filters],
    queryFn: () => fetchJson(`/bets${qs ? `?${qs}` : ""}`),
  });
}

export function usePredictions(filters?: { competitorId?: string }) {
  const params = new URLSearchParams();
  if (filters?.competitorId) params.set("competitorId", filters.competitorId);
  const qs = params.toString();
  return useQuery<PredictionSummary[]>({
    queryKey: ["predictions", filters],
    queryFn: () => fetchJson(`/predictions${qs ? `?${qs}` : ""}`),
  });
}
