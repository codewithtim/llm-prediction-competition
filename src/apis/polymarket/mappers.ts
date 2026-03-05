import type { Event, Market } from "@domain/models/market.ts";
import { safeFloat } from "../../shared/safe-float.ts";
import type { GammaEvent, GammaMarket } from "./types.ts";

export function mapGammaMarketToMarket(raw: GammaMarket): Market | null {
  if (!raw.outcomes || !raw.outcomePrices || !raw.clobTokenIds) return null;
  const outcomes = JSON.parse(raw.outcomes) as [string, string];
  const outcomePrices = JSON.parse(raw.outcomePrices) as [string, string];
  const tokenIds = JSON.parse(raw.clobTokenIds) as [string, string];

  return {
    id: raw.id,
    conditionId: raw.conditionId,
    slug: raw.slug,
    question: raw.question,
    outcomes,
    outcomePrices,
    tokenIds,
    active: raw.active,
    closed: raw.closed,
    acceptingOrders: raw.acceptingOrders,
    liquidity: safeFloat(raw.liquidityNum),
    volume: safeFloat(raw.volumeNum),
    gameId: raw.gameId ?? null,
    sportsMarketType: raw.sportsMarketType ?? null,
    line: null,
    polymarketUrl: null,
  };
}

export function mapGammaEventToEvent(raw: GammaEvent): Event {
  const polymarketUrl = `https://polymarket.com/sports/${raw.seriesSlug}/${raw.slug}`;
  const eventGameId = raw.gameId != null ? String(raw.gameId) : null;

  const markets = raw.markets
    .map(mapGammaMarketToMarket)
    .filter((m): m is Market => m !== null)
    .map((m) => ({ ...m, polymarketUrl, gameId: m.gameId ?? eventGameId }));

  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    startDate: raw.startTime || raw.startDate,
    endDate: raw.endDate,
    active: raw.active,
    closed: raw.closed,
    markets,
  };
}
