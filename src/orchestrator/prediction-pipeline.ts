import type { GammaClient } from "../apis/polymarket/gamma-client.ts";
import { mapGammaMarketToMarket } from "../apis/polymarket/mappers.ts";
import type { FootballClient } from "../apis/sports-data/client.ts";
import {
  mapApiInjuries,
  mapApiPlayerToPlayerStats,
  mapApiTeamStatistics,
  mapH2hFixturesToH2H,
  mapStandingToTeamStats,
} from "../apis/sports-data/mappers.ts";
import type { CompetitorRegistry } from "../competitors/registry.ts";
import type { fixturesRepo as fixturesRepoFactory } from "../database/repositories/fixtures.ts";
import type { marketsRepo as marketsRepoFactory } from "../database/repositories/markets.ts";
import type { predictionsRepo as predictionsRepoFactory } from "../database/repositories/predictions.ts";
import type { statsCacheRepo as statsCacheRepoFactory } from "../database/repositories/stats-cache.ts";
import type {
  H2H,
  Injury,
  MarketContext,
  PlayerSeasonStats,
  Statistics,
  TeamSeasonStats,
  TeamStats,
} from "../domain/contracts/statistics.ts";
import type { Fixture } from "../domain/models/fixture.ts";
import type { Market } from "../domain/models/market.ts";
import type { BankrollProvider } from "../domain/services/bankroll.ts";
import type { BettingService } from "../domain/services/betting.ts";
import { validateStake } from "../domain/services/stake-validator.ts";
import { runAllEngines } from "../engine/runner.ts";
import type { EngineResult } from "../engine/types.ts";
import { logger } from "../shared/logger.ts";
import { safeFloat } from "../shared/safe-float.ts";
import {
  DEFAULT_LEAGUE_TIER,
  LEAGUE_TIERS,
  type LeagueConfig,
  type PipelineConfig,
} from "./config.ts";
import {
  dbRowToFixture,
  dbRowToMarket,
  type FixtureRow,
  type MarketRow,
  marketToDbRow,
} from "./converters.ts";

export type PredictionPipelineDeps = {
  gammaClient: GammaClient;
  footballClient: FootballClient;
  registry: CompetitorRegistry;
  bettingService: BettingService;
  bankrollProvider: BankrollProvider;
  marketsRepo: ReturnType<typeof marketsRepoFactory>;
  fixturesRepo: ReturnType<typeof fixturesRepoFactory>;
  predictionsRepo: ReturnType<typeof predictionsRepoFactory>;
  statsCache: ReturnType<typeof statsCacheRepoFactory>;
  config: PipelineConfig;
};

export type PlacedBetDetail = {
  competitorId: string;
  marketId: string;
  fixtureId: number;
  side: "YES" | "NO";
  amount: number;
  price: number;
  marketQuestion: string;
  fixtureLabel: string;
};

export type FailedBetDetail = {
  competitorId: string;
  marketId: string;
  fixtureId: number;
  side: "YES" | "NO";
  amount: number;
  marketQuestion: string;
  fixtureLabel: string;
  error: string;
};

export type PredictionPipelineResult = {
  fixturesProcessed: number;
  predictionsGenerated: number;
  betsPlaced: number;
  betsDryRun: number;
  betsSkipped: number;
  oddsRefreshed: number;
  oddsRefreshFailed: number;
  errors: string[];
  placedBetDetails: PlacedBetDetail[];
  failedBetDetails: FailedBetDetail[];
};

type PreFetchedFixtureData = {
  fixture: Fixture;
  fixtureLabel: string;
  marketRows: MarketRow[];
  homeStats: TeamStats;
  awayStats: TeamStats;
  h2h: H2H;
  injuries: Injury[];
  homeTeamSeasonStats?: TeamSeasonStats;
  awayTeamSeasonStats?: TeamSeasonStats;
  homeTeamPlayers?: PlayerSeasonStats[];
  awayTeamPlayers?: PlayerSeasonStats[];
  homeTeamLeagueTier?: number;
  awayTeamLeagueTier?: number;
};

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

const STATS_CACHE_TTL = 24 * 60 * 60 * 1000;

export function summarisePlayerStats(
  allPlayers: PlayerSeasonStats[],
  injuries: Injury[],
): PlayerSeasonStats[] {
  const sorted = [...allPlayers].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const top = sorted.slice(0, 8);
  const injuredIds = new Set(injuries.map((i) => i.playerId));
  for (const player of allPlayers) {
    if (injuredIds.has(player.playerId) && !top.find((p) => p.playerId === player.playerId)) {
      top.push(player);
    }
  }
  return top;
}

async function fetchTeamSeasonStats(
  teamId: number,
  leagueId: number,
  season: number,
  fixtureDate: string,
  footballClient: FootballClient,
  statsCache: ReturnType<typeof statsCacheRepoFactory>,
): Promise<TeamSeasonStats | undefined> {
  const cached = await statsCache.getTeamStats(teamId, leagueId, season, STATS_CACHE_TTL);
  if (cached) return cached;
  const resp = await footballClient.getTeamStatistics(teamId, leagueId, season, fixtureDate);
  const mapped = mapApiTeamStatistics(resp.response);
  await statsCache.setTeamStats(teamId, leagueId, season, mapped);
  return mapped;
}

async function fetchPlayerStats(
  teamId: number,
  leagueId: number,
  season: number,
  injuries: Injury[],
  footballClient: FootballClient,
  statsCache: ReturnType<typeof statsCacheRepoFactory>,
): Promise<PlayerSeasonStats[] | undefined> {
  const cached = await statsCache.getPlayerStats(teamId, leagueId, season, STATS_CACHE_TTL);
  let players: PlayerSeasonStats[];
  if (cached) {
    players = cached;
  } else {
    const raw = await footballClient.getAllPlayers(teamId, season);
    players = raw
      .map((p) => mapApiPlayerToPlayerStats(p, leagueId))
      .filter((p): p is PlayerSeasonStats => p !== null && p.appearances > 0);
    await statsCache.setPlayerStats(teamId, leagueId, season, players);
  }
  return summarisePlayerStats(players, injuries);
}

export function createPredictionPipeline(deps: PredictionPipelineDeps) {
  const {
    gammaClient,
    footballClient,
    registry,
    bettingService,
    bankrollProvider,
    marketsRepo,
    fixturesRepo,
    predictionsRepo,
    statsCache,
    config,
  } = deps;

  const standingsCache = new Map<string, Awaited<ReturnType<typeof footballClient.getStandings>>>();

  async function getStandingsCached(leagueId: number, season: number) {
    const key = `${leagueId}:${season}`;
    const cached = standingsCache.get(key);
    if (cached) return cached;
    const resp = await footballClient.getStandings(leagueId, season);
    standingsCache.set(key, resp);
    return resp;
  }

  function findLeagueConfig(leagueId: number): LeagueConfig | undefined {
    return config.leagues.find((l) => l.id === leagueId);
  }

  type DomesticStandingsResult = {
    standing: Awaited<
      ReturnType<typeof footballClient.getStandings>
    >["response"][0]["league"]["standings"][0][0];
    leagueId: number;
  };

  async function findTeamDomesticStandings(
    teamId: number,
    domesticLeagueIds: number[],
    season: number,
  ): Promise<DomesticStandingsResult | null> {
    for (const leagueId of domesticLeagueIds) {
      const resp = await getStandingsCached(leagueId, season);
      const allStandings = resp.response.flatMap((r) => r.league.standings.flat());
      const standing = allStandings.find((s) => s.team.id === teamId);
      if (standing) return { standing, leagueId };
    }
    return null;
  }

  async function gatherFixtureStats(
    fixtureRow: FixtureRow,
    result: PredictionPipelineResult,
  ): Promise<PreFetchedFixtureData | null> {
    const fixture = dbRowToFixture(fixtureRow);
    const fixtureLabel = `${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`;

    const marketRows = await marketsRepo.findByFixtureId(fixture.id);
    if (marketRows.length === 0) {
      logger.info("Prediction: no markets for fixture, skipping", {
        fixtureId: fixture.id,
        fixture: fixtureLabel,
      });
      return null;
    }

    // Determine if this is a cup fixture
    const leagueConfig = findLeagueConfig(fixture.league.id);
    const isCup = leagueConfig?.type === "cup";
    const domesticLeagueIds = leagueConfig?.domesticLeagueIds ?? [];

    // Fetch H2H and injuries in parallel — they're always needed
    const [h2hResp, injuriesResult] = await Promise.allSettled([
      footballClient.getHeadToHead(fixture.homeTeam.id, fixture.awayTeam.id),
      footballClient.getInjuries(fixture.id),
    ]);

    let homeStats: TeamStats;
    let awayStats: TeamStats;
    let homeLeagueId = fixture.league.id;
    let awayLeagueId = fixture.league.id;

    const emptyRecord = { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
    const emptyTeamStats = (teamId: number, teamName: string): TeamStats => ({
      teamId,
      teamName,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      form: null,
      homeRecord: emptyRecord,
      awayRecord: emptyRecord,
    });

    if (isCup && domesticLeagueIds.length > 0) {
      // Cup fixture: resolve each team's domestic league standings
      const [homeDomestic, awayDomestic] = await Promise.all([
        findTeamDomesticStandings(fixture.homeTeam.id, domesticLeagueIds, fixture.league.season),
        findTeamDomesticStandings(fixture.awayTeam.id, domesticLeagueIds, fixture.league.season),
      ]);

      if (homeDomestic) {
        homeStats = mapStandingToTeamStats(homeDomestic.standing);
        homeLeagueId = homeDomestic.leagueId;
        logger.info("Prediction: found domestic standings for home team", {
          fixtureId: fixture.id,
          teamId: fixture.homeTeam.id,
          domesticLeagueId: homeDomestic.leagueId,
        });
      } else {
        homeStats = emptyTeamStats(fixture.homeTeam.id, fixture.homeTeam.name);
        logger.warn("Prediction: no domestic standings found for home team", {
          fixtureId: fixture.id,
          teamId: fixture.homeTeam.id,
          searchedLeagues: domesticLeagueIds,
        });
      }

      if (awayDomestic) {
        awayStats = mapStandingToTeamStats(awayDomestic.standing);
        awayLeagueId = awayDomestic.leagueId;
        logger.info("Prediction: found domestic standings for away team", {
          fixtureId: fixture.id,
          teamId: fixture.awayTeam.id,
          domesticLeagueId: awayDomestic.leagueId,
        });
      } else {
        awayStats = emptyTeamStats(fixture.awayTeam.id, fixture.awayTeam.name);
        logger.warn("Prediction: no domestic standings found for away team", {
          fixtureId: fixture.id,
          teamId: fixture.awayTeam.id,
          searchedLeagues: domesticLeagueIds,
        });
      }
    } else {
      // Regular league fixture: fetch standings from the fixture's league
      const standingsResp = await getStandingsCached(fixture.league.id, fixture.league.season)
        .then((v) => ({ status: "fulfilled" as const, value: v }))
        .catch((reason) => ({ status: "rejected" as const, reason }));

      if (standingsResp.status === "rejected") {
        const msg =
          standingsResp.reason instanceof Error
            ? standingsResp.reason.message
            : String(standingsResp.reason);
        result.errors.push(
          `Standings fetch failed for fixture ${fixture.id} (${fixtureLabel}): ${msg}`,
        );
        return null;
      }

      const allStandings = standingsResp.value.response.flatMap((r) => r.league.standings.flat());
      const homeStanding = allStandings.find((s) => s.team.id === fixture.homeTeam.id);
      const awayStanding = allStandings.find((s) => s.team.id === fixture.awayTeam.id);

      homeStats = homeStanding
        ? mapStandingToTeamStats(homeStanding)
        : emptyTeamStats(fixture.homeTeam.id, fixture.homeTeam.name);

      awayStats = awayStanding
        ? mapStandingToTeamStats(awayStanding)
        : emptyTeamStats(fixture.awayTeam.id, fixture.awayTeam.name);

      if (!homeStanding || !awayStanding) {
        logger.warn("Prediction: standings not found, continuing with empty stats", {
          fixtureId: fixture.id,
          fixture: fixtureLabel,
          leagueId: fixture.league.id,
          missingHome: !homeStanding,
          missingAway: !awayStanding,
        });
      }
    }

    // Resolve league tiers
    const homeTeamLeagueTier = LEAGUE_TIERS[homeLeagueId] ?? DEFAULT_LEAGUE_TIER;
    const awayTeamLeagueTier = LEAGUE_TIERS[awayLeagueId] ?? DEFAULT_LEAGUE_TIER;

    let h2h: H2H;
    if (h2hResp.status === "fulfilled") {
      h2h = mapH2hFixturesToH2H(h2hResp.value.response, fixture.homeTeam.id);
    } else {
      const msg = h2hResp.reason instanceof Error ? h2hResp.reason.message : String(h2hResp.reason);
      logger.warn("Prediction: H2H fetch failed, using empty", {
        fixtureId: fixture.id,
        error: msg,
      });
      h2h = { totalMatches: 0, homeWins: 0, awayWins: 0, draws: 0, recentMatches: [] };
    }

    let injuries: Injury[] = [];
    if (injuriesResult.status === "fulfilled") {
      injuries = mapApiInjuries(injuriesResult.value.response);
    } else {
      const msg =
        injuriesResult.reason instanceof Error
          ? injuriesResult.reason.message
          : String(injuriesResult.reason);
      logger.warn("Prediction: injuries fetch failed, continuing without", {
        fixtureId: fixture.id,
        error: msg,
      });
    }

    // Fetch season stats and player stats using resolved domestic league IDs
    const [homeStatsResult, awayStatsResult, homePlayersResult, awayPlayersResult] =
      await Promise.allSettled([
        fetchTeamSeasonStats(
          fixture.homeTeam.id,
          homeLeagueId,
          fixture.league.season,
          fixture.date,
          footballClient,
          statsCache,
        ),
        fetchTeamSeasonStats(
          fixture.awayTeam.id,
          awayLeagueId,
          fixture.league.season,
          fixture.date,
          footballClient,
          statsCache,
        ),
        fetchPlayerStats(
          fixture.homeTeam.id,
          homeLeagueId,
          fixture.league.season,
          injuries,
          footballClient,
          statsCache,
        ),
        fetchPlayerStats(
          fixture.awayTeam.id,
          awayLeagueId,
          fixture.league.season,
          injuries,
          footballClient,
          statsCache,
        ),
      ]);

    const unpack = <T>(settled: PromiseSettledResult<T>, label: string): T | undefined => {
      if (settled.status === "fulfilled") return settled.value;
      const msg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
      logger.warn(`Prediction: ${label} fetch failed`, { fixtureId: fixture.id, error: msg });
      return undefined;
    };

    const homeTeamSeasonStats = unpack(homeStatsResult, "home team stats");
    const awayTeamSeasonStats = unpack(awayStatsResult, "away team stats");
    const homeTeamPlayers = unpack(homePlayersResult, "home player stats");
    const awayTeamPlayers = unpack(awayPlayersResult, "away player stats");

    if (!homeTeamSeasonStats || !awayTeamSeasonStats || !homeTeamPlayers || !awayTeamPlayers) {
      logger.warn("Prediction: incomplete enriched stats, continuing without", {
        fixtureId: fixture.id,
        fixture: fixtureLabel,
        missing: [
          !homeTeamSeasonStats && "home team stats",
          !awayTeamSeasonStats && "away team stats",
          !homeTeamPlayers && "home player stats",
          !awayTeamPlayers && "away player stats",
        ].filter(Boolean),
      });
    }

    return {
      fixture,
      fixtureLabel,
      marketRows,
      homeStats,
      awayStats,
      h2h,
      injuries,
      homeTeamSeasonStats,
      awayTeamSeasonStats,
      homeTeamPlayers,
      awayTeamPlayers,
      homeTeamLeagueTier,
      awayTeamLeagueTier,
    };
  }

  async function processFixture(
    data: PreFetchedFixtureData,
    engines: ReturnType<typeof registry.getAll>,
    result: PredictionPipelineResult,
  ): Promise<void> {
    const { fixture, marketRows } = data;

    // Refresh odds from Gamma and update DB
    const marketMap = new Map<string, Market>();
    for (const row of marketRows) {
      let market = dbRowToMarket(row);
      try {
        const freshGamma = await gammaClient.getMarketById(market.id);
        if (freshGamma) {
          const freshMarket = mapGammaMarketToMarket(freshGamma);
          if (freshMarket) {
            freshMarket.polymarketUrl = market.polymarketUrl;
            logger.info("Prediction: odds refreshed", {
              marketId: market.id,
              oldPrices: market.outcomePrices,
              newPrices: freshMarket.outcomePrices,
            });
            await marketsRepo.upsert(marketToDbRow(freshMarket, row.fixtureId));
            market = freshMarket;
            result.oddsRefreshed++;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("Prediction: odds refresh failed, using cached prices", {
          marketId: market.id,
          error: msg,
        });
        result.oddsRefreshFailed++;
      }
      marketMap.set(market.id, market);
    }

    const marketContexts: MarketContext[] = [];
    for (const market of marketMap.values()) {
      marketContexts.push(buildMarketContext(market));
    }

    if (marketContexts.length === 0) return;

    const statistics: Statistics = {
      fixtureId: fixture.id,
      league: fixture.league,
      homeTeam: data.homeStats,
      awayTeam: data.awayStats,
      h2h: data.h2h,
      markets: marketContexts,
      injuries: data.injuries,
      homeTeamSeasonStats: data.homeTeamSeasonStats,
      awayTeamSeasonStats: data.awayTeamSeasonStats,
      homeTeamPlayers: data.homeTeamPlayers,
      awayTeamPlayers: data.awayTeamPlayers,
      homeTeamLeagueTier: data.homeTeamLeagueTier,
      awayTeamLeagueTier: data.awayTeamLeagueTier,
    };

    result.fixturesProcessed++;

    const engineResults = await runAllEngines(engines, statistics);

    for (const engineResult of engineResults) {
      if ("error" in engineResult) {
        result.errors.push(
          `Engine ${engineResult.competitorId} failed on fixture ${fixture.id}: ${engineResult.error}`,
        );
        continue;
      }

      const { competitorId, predictions } = engineResult as EngineResult;

      const existingPredictions = await predictionsRepo.findByFixtureAndCompetitor(
        fixture.id,
        competitorId,
      );
      if (existingPredictions.length > 0) {
        logger.info("Prediction: competitor already predicted for fixture, skipping", {
          competitorId,
          fixtureId: fixture.id,
        });
        continue;
      }

      let bankroll: number;
      try {
        bankroll = await bankrollProvider.getBankroll(competitorId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Bankroll fetch failed for ${competitorId}: ${msg}`);
        continue;
      }

      for (const prediction of predictions) {
        const market = marketMap.get(prediction.marketId);
        if (!market) {
          result.errors.push(
            `Engine ${competitorId} returned prediction for unknown market ${prediction.marketId}`,
          );
          continue;
        }

        const absoluteStake = safeFloat(prediction.stake * bankroll);
        if (absoluteStake <= 0) {
          result.betsSkipped++;
          continue;
        }

        try {
          await predictionsRepo.create({
            marketId: prediction.marketId,
            fixtureId: fixture.id,
            competitorId,
            side: prediction.side,
            confidence: prediction.confidence,
            stake: absoluteStake,
            reasoning: prediction.reasoning,
            extractedFeatures: prediction.extractedFeatures ?? null,
          });
          result.predictionsGenerated++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Prediction save failed: ${msg}`);
        }

        const validation = validateStake(absoluteStake, bankroll, {
          maxBetPctOfBankroll: config.betting.maxBetPctOfBankroll,
          minBetAmount: config.betting.minBetAmount,
        });

        if (!validation.valid) {
          logger.warn("Prediction: stake rejected", {
            competitorId,
            fixtureId: fixture.id,
            marketId: prediction.marketId,
            reason: validation.reason,
            requestedStake: absoluteStake,
            bankroll,
          });
          result.betsSkipped++;
          continue;
        }

        const failedBase: Omit<FailedBetDetail, "error"> = {
          competitorId,
          marketId: market.id,
          fixtureId: fixture.id,
          side: prediction.side,
          amount: absoluteStake,
          marketQuestion: market.question,
          fixtureLabel: data.fixtureLabel,
        };

        try {
          const engineEntry = engines.find((e) => e.competitorId === competitorId);
          const betResult = await bettingService.placeBet({
            prediction,
            resolvedStake: absoluteStake,
            market,
            fixtureId: fixture.id,
            competitorId,
            walletConfig: engineEntry?.walletConfig,
          });

          if (betResult.status === "placed") {
            result.betsPlaced++;
            result.placedBetDetails.push({
              ...failedBase,
              price: Number.parseFloat(
                prediction.side === "YES" ? market.outcomePrices[0] : market.outcomePrices[1],
              ),
            });
          } else if (betResult.status === "dry_run") {
            result.betsDryRun++;
          } else if (betResult.status === "failed") {
            result.betsSkipped++;
            result.failedBetDetails.push({
              ...failedBase,
              error: betResult.error ?? "Unknown error",
            });
            logger.warn("Prediction: bet failed", {
              competitorId,
              fixtureId: fixture.id,
              marketId: market.id,
              error: betResult.error,
              errorCategory: betResult.errorCategory,
            });
          } else {
            result.betsSkipped++;
            logger.info("Prediction: bet skipped", {
              competitorId,
              fixtureId: fixture.id,
              marketId: market.id,
              reason: betResult.reason,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Bet placement failed: ${msg}`);
          result.betsSkipped++;
          result.failedBetDetails.push({ ...failedBase, error: msg });
        }
      }
    }
  }

  return {
    async run(): Promise<PredictionPipelineResult> {
      standingsCache.clear();
      const result: PredictionPipelineResult = {
        fixturesProcessed: 0,
        predictionsGenerated: 0,
        betsPlaced: 0,
        betsDryRun: 0,
        betsSkipped: 0,
        oddsRefreshed: 0,
        oddsRefreshFailed: 0,
        errors: [],
        placedBetDetails: [],
        failedBetDetails: [],
      };

      const fixtureRows = await fixturesRepo.findReadyForPrediction(config.predictionLeadTimeMs);
      logger.info("Prediction: found fixtures ready for prediction", { count: fixtureRows.length });

      if (fixtureRows.length === 0) {
        logger.info("Prediction: no fixtures within prediction window");
        return result;
      }

      const engines = registry.getAll();
      if (engines.length === 0) {
        logger.warn("Prediction: no engines registered, skipping predictions");
        return result;
      }

      // Phase 1: Pre-fetch all stable data
      const preFetched: PreFetchedFixtureData[] = [];
      for (const fixtureRow of fixtureRows) {
        try {
          const data = await gatherFixtureStats(fixtureRow, result);
          if (data) preFetched.push(data);
        } catch (err) {
          const fixture = dbRowToFixture(fixtureRow);
          const fixtureLabel = `${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`;
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Fixture processing failed (${fixtureLabel}): ${msg}`);
          logger.error("Prediction: fixture stats gathering failed", {
            fixture: fixture.id,
            error: msg,
          });
        }
      }

      // Phase 2: Tight odds→predict→bet per fixture
      for (const data of preFetched) {
        try {
          await processFixture(data, engines, result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Fixture processing failed (${data.fixtureLabel}): ${msg}`);
          logger.error("Prediction: fixture processing failed", {
            fixture: data.fixture.id,
            error: msg,
          });
        }
      }

      logger.info("Prediction: run complete", {
        fixturesProcessed: result.fixturesProcessed,
        predictions: result.predictionsGenerated,
        betsPlaced: result.betsPlaced,
        betsDryRun: result.betsDryRun,
        betsSkipped: result.betsSkipped,
        oddsRefreshed: result.oddsRefreshed,
        oddsRefreshFailed: result.oddsRefreshFailed,
        errors: result.errors.length,
      });

      for (const error of result.errors) {
        logger.error("Prediction error", { message: error });
      }

      return result;
    },
  };
}

export type PredictionPipeline = ReturnType<typeof createPredictionPipeline>;
