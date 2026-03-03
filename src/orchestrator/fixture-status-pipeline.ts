import type { fixturesRepo as fixturesRepoFactory } from "../infrastructure/database/repositories/fixtures.ts";
import type { FootballClient } from "../infrastructure/sports-data/client.ts";
import { mapFixtureStatus } from "../infrastructure/sports-data/mappers.ts";
import { logger } from "../shared/logger.ts";

export type FixtureStatusPipelineResult = {
  fixturesChecked: number;
  statusesUpdated: number;
  errors: string[];
};

export type FixtureStatusPipelineDeps = {
  footballClient: FootballClient;
  fixturesRepo: ReturnType<typeof fixturesRepoFactory>;
};

export function createFixtureStatusPipeline(deps: FixtureStatusPipelineDeps) {
  const { footballClient, fixturesRepo } = deps;

  return {
    async run(): Promise<FixtureStatusPipelineResult> {
      const result: FixtureStatusPipelineResult = {
        fixturesChecked: 0,
        statusesUpdated: 0,
        errors: [],
      };

      const rows = await fixturesRepo.findNeedingStatusUpdate();
      logger.info("FixtureStatus: found fixtures needing update", { count: rows.length });

      for (const row of rows) {
        result.fixturesChecked++;
        try {
          const resp = await footballClient.getFixtures({ id: row.id });
          if (resp.response.length === 0) {
            logger.warn("FixtureStatus: no API response for fixture", { fixtureId: row.id });
            continue;
          }

          const apiFixture = resp.response[0];
          if (!apiFixture) continue;
          const newStatus = mapFixtureStatus(apiFixture.fixture.status.short);

          if (newStatus !== row.status) {
            await fixturesRepo.updateStatus(row.id, newStatus);
            result.statusesUpdated++;
            logger.info("FixtureStatus: status updated", {
              fixtureId: row.id,
              from: row.status,
              to: newStatus,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Status check failed for fixture ${row.id}: ${msg}`);
          logger.error("FixtureStatus: status check failed", { fixtureId: row.id, error: msg });
        }
      }

      logger.info("FixtureStatus: run complete", {
        fixturesChecked: result.fixturesChecked,
        statusesUpdated: result.statusesUpdated,
        errors: result.errors.length,
      });

      return result;
    },
  };
}

export type FixtureStatusPipeline = ReturnType<typeof createFixtureStatusPipeline>;
