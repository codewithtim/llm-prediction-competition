/**
 * Test Pipeline — end-to-end smoke test for the prediction engine.
 *
 * Wires together: Polymarket discovery → API-Football fixtures → matching →
 * statistics gathering → baseline engine → prediction output.
 *
 * Usage:
 *   API_SPORTS_KEY=xxx bun run src/scripts/test-pipeline.ts
 *
 * Only requires API_SPORTS_KEY. Polymarket Gamma API is public (no auth).
 */

import { createWeightedEngine } from "../competitors/weight-tuned/engine.ts";
import { DEFAULT_STAKE_CONFIG, DEFAULT_WEIGHTS } from "../competitors/weight-tuned/types.ts";
import type { MarketContext, Statistics } from "../domain/contracts/statistics.ts";
import type { Fixture } from "../domain/models/fixture.ts";
import type { Event, Market } from "../domain/models/market.ts";
import type { MatchedFixture } from "../domain/services/market-matching.ts";
import { matchEventsToFixtures } from "../domain/services/market-matching.ts";
import { runEngine } from "../engine/runner.ts";
import { createGammaClient } from "../infrastructure/polymarket/gamma-client.ts";
import { createMarketDiscovery } from "../infrastructure/polymarket/market-discovery.ts";
import { createFootballClient } from "../infrastructure/sports-data/client.ts";
import {
  mapApiFixtureToFixture,
  mapH2hFixturesToH2H,
  mapStandingToTeamStats,
} from "../infrastructure/sports-data/mappers.ts";

// Top European leagues (API-Football IDs + Polymarket tag IDs)
const LEAGUES = [
  {
    id: 39,
    name: "Premier League",
    country: "England",
    polymarketTagIds: [82],
    polymarketSeriesSlug: "premier-league",
  },
  {
    id: 140,
    name: "La Liga",
    country: "Spain",
    polymarketTagIds: [306],
    polymarketSeriesSlug: "la-liga",
  },
  {
    id: 135,
    name: "Serie A",
    country: "Italy",
    polymarketTagIds: [100350],
    polymarketSeriesSlug: "serie-a",
  },
  {
    id: 78,
    name: "Bundesliga",
    country: "Germany",
    polymarketTagIds: [100350],
    polymarketSeriesSlug: "bundesliga",
  },
  {
    id: 61,
    name: "Ligue 1",
    country: "France",
    polymarketTagIds: [100350],
    polymarketSeriesSlug: "ligue-1",
  },
];

// API-Football free tier only covers seasons 2022-2024.
// Season 2024 = the 2024-25 campaign. Use historical dates to test the pipeline.
const SEASON = 2024;

function divider(label: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(60)}\n`);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildSyntheticMarketContext(fixture: Fixture): MarketContext {
  return {
    marketId: `synthetic-${fixture.id}`,
    question: `Will ${fixture.homeTeam.name} beat ${fixture.awayTeam.name}?`,
    currentYesPrice: 0.5,
    currentNoPrice: 0.5,
    liquidity: 0,
    volume: 0,
    sportsMarketType: "moneyline",
    line: null,
  };
}

function buildMarketContext(market: Market): MarketContext {
  return {
    marketId: market.id,
    question: market.question,
    currentYesPrice: Number.parseFloat(market.outcomePrices[0]),
    currentNoPrice: Number.parseFloat(market.outcomePrices[1]),
    liquidity: market.liquidity,
    volume: market.volume,
    sportsMarketType: market.sportsMarketType,
    line: market.line,
  };
}

async function main() {
  const apiKey = process.env.API_SPORTS_KEY;
  if (!apiKey) {
    console.error("Missing API_SPORTS_KEY. Usage:");
    console.error("  API_SPORTS_KEY=xxx bun run src/scripts/test-pipeline.ts");
    process.exit(1);
  }

  const football = createFootballClient(apiKey);
  const gamma = createGammaClient();
  const discovery = createMarketDiscovery(gamma, {
    leagues: LEAGUES,
    lookAheadDays: 10,
  });

  // ── Step 1: Discover Polymarket football markets ──────────────────────
  divider("Step 1: Discovering Polymarket football markets");

  let events: Event[];
  try {
    events = await discovery.discoverFootballMarkets();
    const totalMarkets = events.reduce((sum, e) => sum + e.markets.length, 0);
    console.log(`Found ${events.length} events with ${totalMarkets} markets`);
    for (const e of events.slice(0, 8)) {
      console.log(`  - ${e.title} (${formatDate(e.startDate)}) [${e.markets.length} markets]`);
    }
    if (events.length > 8) console.log(`  ... and ${events.length - 8} more`);
  } catch (err) {
    console.warn("Polymarket discovery failed (non-fatal):", (err as Error).message);
    events = [];
  }

  // ── Step 2: Fetch upcoming fixtures from API-Football ─────────────────
  divider("Step 2: Fetching upcoming fixtures from API-Football");

  // Use historical dates from the 2024-25 season (free tier).
  // A busy EPL weekend in March 2025 ensures plenty of fixtures.
  const from = "2025-03-01";
  const to = "2025-03-10";
  console.log(`Date range: ${from} → ${to} (season ${SEASON}, historical data)\n`);

  const allFixtures: Fixture[] = [];
  for (const league of LEAGUES) {
    const resp = await football.getFixtures({
      league: league.id,
      season: SEASON,
      from,
      to,
    });
    const fixtures = resp.response.map(mapApiFixtureToFixture);
    console.log(`  ${league.name} (${league.country}): ${fixtures.length} fixtures`);
    for (const f of fixtures) {
      console.log(`    ${f.homeTeam.name} vs ${f.awayTeam.name} — ${formatDate(f.date)}`);
    }
    allFixtures.push(...fixtures);
  }

  if (allFixtures.length === 0) {
    console.log("\nNo upcoming fixtures found in the next 7 days. Try a different date range.");
    return;
  }
  console.log(`\nTotal: ${allFixtures.length} fixtures across ${LEAGUES.length} leagues`);

  // ── Step 3: Match markets to fixtures ─────────────────────────────────
  divider("Step 3: Matching Polymarket events to fixtures");

  let targetFixture: Fixture;
  let marketContexts: MarketContext[];
  let matchSource: string;

  if (events.length > 0) {
    const matchResult = matchEventsToFixtures(events, allFixtures);
    console.log(`Matched: ${matchResult.matched.length} fixtures`);
    console.log(`Unmatched Polymarket events: ${matchResult.unmatchedEvents.length}`);
    console.log(`Unmatched API-Football fixtures: ${matchResult.unmatchedFixtures.length}`);

    const pick = matchResult.matched.length > 0 ? pickBestMatch(matchResult.matched) : null;

    if (pick && pick.markets.length > 0) {
      targetFixture = pick.fixture;
      marketContexts = pick.markets.map((mm) => buildMarketContext(mm.market));
      matchSource = "polymarket";

      console.log(`\nSelected: ${targetFixture.homeTeam.name} vs ${targetFixture.awayTeam.name}`);
      console.log(`  Markets: ${marketContexts.length}`);
      for (const mc of marketContexts) {
        console.log(`    - ${mc.question} (Yes: ${mc.currentYesPrice} / No: ${mc.currentNoPrice})`);
      }
    } else {
      console.log(
        "\nNo Polymarket ↔ fixture matches. Falling back to first fixture with synthetic market.",
      );
      targetFixture = allFixtures[0] as Fixture;
      marketContexts = [buildSyntheticMarketContext(targetFixture)];
      matchSource = "synthetic";
    }
  } else {
    console.log("No Polymarket events available. Using first fixture with synthetic market.");
    targetFixture = allFixtures[0] as Fixture;
    marketContexts = [buildSyntheticMarketContext(targetFixture)];
    matchSource = "synthetic";
  }

  // ── Step 4: Gather statistics ─────────────────────────────────────────
  divider(
    `Step 4: Gathering statistics for ${targetFixture.homeTeam.name} vs ${targetFixture.awayTeam.name}`,
  );

  // Fetch league standings
  console.log(
    `Fetching ${targetFixture.league.name} standings (season ${targetFixture.league.season})...`,
  );
  const standingsResp = await football.getStandings(
    targetFixture.league.id,
    targetFixture.league.season,
  );
  const allStandings = standingsResp.response.flatMap((r) => r.league.standings.flat());

  const homeStanding = allStandings.find((s) => s.team.id === targetFixture.homeTeam.id);
  const awayStanding = allStandings.find((s) => s.team.id === targetFixture.awayTeam.id);

  if (!homeStanding || !awayStanding) {
    console.error("Could not find standings for one or both teams:");
    console.error(
      `  Home (${targetFixture.homeTeam.name}, id=${targetFixture.homeTeam.id}): ${homeStanding ? "found" : "MISSING"}`,
    );
    console.error(
      `  Away (${targetFixture.awayTeam.name}, id=${targetFixture.awayTeam.id}): ${awayStanding ? "found" : "MISSING"}`,
    );
    return;
  }

  const homeStats = mapStandingToTeamStats(homeStanding);
  const awayStats = mapStandingToTeamStats(awayStanding);

  console.log(`\n  ${homeStats.teamName}:`);
  console.log(`    Position: ${homeStanding.rank} | ${homeStats.points} pts`);
  console.log(
    `    Record: ${homeStats.wins}W ${homeStats.draws}D ${homeStats.losses}L (GD: ${homeStats.goalDifference > 0 ? "+" : ""}${homeStats.goalDifference})`,
  );
  console.log(
    `    Home: ${homeStats.homeRecord.wins}W ${homeStats.homeRecord.draws}D ${homeStats.homeRecord.losses}L`,
  );
  console.log(`    Form: ${homeStats.form ?? "N/A"}`);

  console.log(`\n  ${awayStats.teamName}:`);
  console.log(`    Position: ${awayStanding.rank} | ${awayStats.points} pts`);
  console.log(
    `    Record: ${awayStats.wins}W ${awayStats.draws}D ${awayStats.losses}L (GD: ${awayStats.goalDifference > 0 ? "+" : ""}${awayStats.goalDifference})`,
  );
  console.log(
    `    Away: ${awayStats.homeRecord.wins}W ${awayStats.homeRecord.draws}D ${awayStats.homeRecord.losses}L`,
  );
  console.log(`    Form: ${awayStats.form ?? "N/A"}`);

  // Fetch head-to-head
  console.log(
    `\nFetching H2H: ${targetFixture.homeTeam.name} vs ${targetFixture.awayTeam.name}...`,
  );
  const h2hResp = await football.getHeadToHead(
    targetFixture.homeTeam.id,
    targetFixture.awayTeam.id,
  );
  const h2h = mapH2hFixturesToH2H(h2hResp.response, targetFixture.homeTeam.id);

  console.log(`  Total meetings: ${h2h.totalMatches}`);
  console.log(
    `  ${targetFixture.homeTeam.name} wins: ${h2h.homeWins} | Draws: ${h2h.draws} | ${targetFixture.awayTeam.name} wins: ${h2h.awayWins}`,
  );
  if (h2h.recentMatches.length > 0) {
    console.log("  Recent:");
    for (const m of h2h.recentMatches.slice(0, 5)) {
      console.log(
        `    ${m.homeTeam} ${m.homeGoals}-${m.awayGoals} ${m.awayTeam} (${formatDate(m.date)})`,
      );
    }
  }

  // ── Step 5: Build Statistics and run engine ───────────────────────────
  divider("Step 5: Running weight-tuned prediction engine");

  const statistics: Statistics = {
    fixtureId: targetFixture.id,
    league: targetFixture.league,
    homeTeam: homeStats,
    awayTeam: awayStats,
    h2h,
    markets: marketContexts,
  };

  const weightTunedEngine = createWeightedEngine(DEFAULT_WEIGHTS, DEFAULT_STAKE_CONFIG);

  console.log(`Market source: ${matchSource}`);
  console.log(`Engine: Weight-Tuned (default weights)\n`);

  const result = await runEngine(
    { competitorId: "test-pipeline", name: "Weight-Tuned", engine: weightTunedEngine },
    statistics,
  );

  // ── Step 6: Print prediction ──────────────────────────────────────────
  divider("PREDICTION RESULT");

  if ("error" in result) {
    console.log(`Engine error: ${result.error}`);
  } else {
    for (const pred of result.predictions) {
      const predMarket = marketContexts.find((mc) => mc.marketId === pred.marketId);
      console.log(`Match:       ${targetFixture.homeTeam.name} vs ${targetFixture.awayTeam.name}`);
      console.log(`Date:        ${formatDate(targetFixture.date)}`);
      console.log(`League:      ${targetFixture.league.name}`);
      console.log(`Market:      ${predMarket?.question ?? pred.marketId}`);
      console.log(`Side:        ${pred.side}`);
      console.log(`Confidence:  ${(pred.confidence * 100).toFixed(1)}%`);
      console.log(`Stake:       $${pred.stake.toFixed(2)} USDC`);
      console.log(`Reasoning:   ${pred.reasoning}`);

      if (matchSource === "polymarket" && predMarket) {
        const impliedProb =
          pred.side === "YES" ? predMarket.currentYesPrice : predMarket.currentNoPrice;
        const edge = pred.confidence - impliedProb;
        console.log(`\nMarket price: ${(impliedProb * 100).toFixed(1)}% (implied)`);
        console.log(`Edge:         ${edge > 0 ? "+" : ""}${(edge * 100).toFixed(1)}pp`);
      } else {
        console.log(`\n(Synthetic market — no real Polymarket pricing to compare against)`);
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("  Pipeline test complete.");
  console.log(`${"=".repeat(60)}\n`);
}

/** Pick the best matched fixture — prefer moneyline markets, then highest liquidity */
function pickBestMatch(matched: MatchedFixture[]): MatchedFixture {
  // Sort: moneyline markets first, then by total market liquidity
  matched.sort((a, b) => {
    const aHasMoneyline = a.markets.some((m) => m.market.sportsMarketType === "moneyline");
    const bHasMoneyline = b.markets.some((m) => m.market.sportsMarketType === "moneyline");
    if (aHasMoneyline && !bHasMoneyline) return -1;
    if (!aHasMoneyline && bHasMoneyline) return 1;

    const aLiquidity = a.markets.reduce((sum, m) => sum + m.market.liquidity, 0);
    const bLiquidity = b.markets.reduce((sum, m) => sum + m.market.liquidity, 0);
    return bLiquidity - aLiquidity;
  });
  return matched[0] as MatchedFixture;
}

main().catch((err) => {
  console.error("\nPipeline failed:", err);
  process.exit(1);
});
