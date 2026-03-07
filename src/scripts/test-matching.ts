/**
 * Matching Diagnostic — fetch live data from Polymarket + API-Football,
 * run matching, and report every match/mismatch in detail.
 *
 * Usage:
 *   bun run src/scripts/test-matching.ts
 *
 * Requires API_SPORTS_KEY in .env. Polymarket Gamma API is public.
 */

import { createGammaClient } from "../apis/polymarket/gamma-client.ts";
import { createMarketDiscovery } from "../apis/polymarket/market-discovery.ts";
import { createFootballClient } from "../apis/sports-data/client.ts";
import { mapApiFixtureToFixture } from "../apis/sports-data/mappers.ts";
import type { Fixture } from "../domain/models/fixture.ts";
import type { Event } from "../domain/models/market.ts";
import { parseEventTitle } from "../domain/services/event-parser.ts";
import { matchEventsToFixtures } from "../domain/services/market-matching.ts";
import { resolveTeamName } from "../domain/services/team-names.ts";
import { LEAGUE_CATALOG } from "../orchestrator/config.ts";
import { createProxyFetch } from "../shared/proxy.ts";

const LEAGUES = [
  LEAGUE_CATALOG.premierLeague,
  LEAGUE_CATALOG.championsLeague,
  LEAGUE_CATALOG.faCup,
];

async function main() {
  const apiKey = process.env.API_SPORTS_KEY;
  if (!apiKey) {
    console.error("Missing API_SPORTS_KEY in .env");
    process.exit(1);
  }

  const proxyUrl = process.env.PROXY_URL;
  const fetchFn = proxyUrl ? createProxyFetch(proxyUrl) : undefined;

  const football = createFootballClient(apiKey);
  const gamma = createGammaClient(fetchFn);
  const discovery = createMarketDiscovery(gamma, {
    leagues: LEAGUES,
    lookAheadDays: 14,
  });

  // ── Fetch Polymarket events ──────────────────────────────────────────
  console.log("Fetching Polymarket events...");
  let events: Event[];
  try {
    events = await discovery.discoverFootballMarkets();
  } catch (err) {
    console.error("Polymarket fetch failed:", (err as Error).message);
    process.exit(1);
  }
  console.log(`  Found ${events.length} events\n`);

  for (const e of events) {
    const parsed = parseEventTitle(e.title);
    const homeResolved = parsed ? resolveTeamName(parsed.homeTeam) : "?";
    const awayResolved = parsed ? resolveTeamName(parsed.awayTeam) : "?";
    console.log(`  [PM] "${e.title}"`);
    console.log(`        date=${e.startDate}  markets=${e.markets.length}`);
    console.log(`        resolved: ${homeResolved} vs ${awayResolved}`);
  }

  // ── Fetch API-Football fixtures ──────────────────────────────────────
  console.log("\nFetching API-Football fixtures...");
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10);

  // Detect season: use current year if month >= August, else year - 1
  const season = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;

  const allFixtures: Fixture[] = [];
  for (const league of LEAGUES) {
    const resp = await football.getFixtures({
      league: league.id,
      season,
      from,
      to,
    });
    const fixtures = resp.response.map(mapApiFixtureToFixture);
    console.log(`  ${league.name}: ${fixtures.length} fixtures`);
    for (const f of fixtures) {
      console.log(`    [AF] ${f.homeTeam.name} vs ${f.awayTeam.name}  date=${f.date}`);
      console.log(
        `         resolved: ${resolveTeamName(f.homeTeam.name)} vs ${resolveTeamName(f.awayTeam.name)}`,
      );
    }
    allFixtures.push(...fixtures);
  }

  if (allFixtures.length === 0) {
    console.log("\nNo fixtures found. Check season/date range.");
    return;
  }

  // ── Run matching ─────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("  MATCHING RESULTS");
  console.log("=".repeat(70));

  const result = matchEventsToFixtures(events, allFixtures);

  console.log(`\n  Matched:             ${result.matched.length}`);
  console.log(`  Unmatched events:    ${result.unmatchedEvents.length}`);
  console.log(`  Unmatched fixtures:  ${result.unmatchedFixtures.length}`);

  // ── Matched ──────────────────────────────────────────────────────────
  if (result.matched.length > 0) {
    console.log("\n── MATCHED ──────────────────────────────────────────────");
    for (const m of result.matched) {
      console.log(
        `  ${m.fixture.homeTeam.name} vs ${m.fixture.awayTeam.name} (${m.fixture.league.name})`,
      );
      console.log(`    fixture date: ${m.fixture.date}`);
      console.log(`    markets: ${m.markets.length}`);
      for (const mm of m.markets) {
        console.log(`      - ${mm.market.question} [${mm.market.sportsMarketType}]`);
      }
    }
  }

  // ── Unmatched events ─────────────────────────────────────────────────
  if (result.unmatchedEvents.length > 0) {
    console.log("\n── UNMATCHED POLYMARKET EVENTS ──────────────────────────");
    console.log("  (These events had no matching API-Football fixture)\n");
    for (const e of result.unmatchedEvents) {
      const parsed = parseEventTitle(e.title);
      const homeResolved = parsed ? resolveTeamName(parsed.homeTeam) : "?";
      const awayResolved = parsed ? resolveTeamName(parsed.awayTeam) : "?";
      console.log(`  "${e.title}"`);
      console.log(`    date=${e.startDate}  markets=${e.markets.length}`);
      console.log(`    resolved: ${homeResolved} vs ${awayResolved}`);

      // Try to find close matches to diagnose why
      if (parsed) {
        for (const f of allFixtures) {
          const fHome = resolveTeamName(f.homeTeam.name);
          const fAway = resolveTeamName(f.awayTeam.name);
          const teamsOverlap =
            homeResolved === fHome ||
            homeResolved === fAway ||
            awayResolved === fHome ||
            awayResolved === fAway;
          if (teamsOverlap) {
            const diffMs = Math.abs(new Date(e.startDate).getTime() - new Date(f.date).getTime());
            const diffH = (diffMs / 3600000).toFixed(1);
            console.log(
              `    ↳ partial match: ${f.homeTeam.name} vs ${f.awayTeam.name} (date=${f.date}, diff=${diffH}h)`,
            );
          }
        }
      }
    }
  }

  // ── Unmatched fixtures ───────────────────────────────────────────────
  if (result.unmatchedFixtures.length > 0) {
    console.log("\n── UNMATCHED API-FOOTBALL FIXTURES ──────────────────────");
    console.log("  (These fixtures had no matching Polymarket event)\n");
    for (const f of result.unmatchedFixtures) {
      console.log(`  ${f.homeTeam.name} vs ${f.awayTeam.name} (${f.league.name})`);
      console.log(`    date=${f.date}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  const matchRate =
    events.length > 0 ? ((result.matched.length / events.length) * 100).toFixed(0) : "N/A";
  console.log(
    `  Events: ${events.length} | Fixtures: ${allFixtures.length} | Matched: ${result.matched.length} (${matchRate}% of events)`,
  );

  if (result.unmatchedEvents.length > 0) {
    console.log(`\n  ⚠ ${result.unmatchedEvents.length} Polymarket event(s) need investigation`);
  } else {
    console.log(`\n  All Polymarket events matched successfully!`);
  }
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
