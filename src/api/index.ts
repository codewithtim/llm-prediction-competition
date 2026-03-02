import { Hono } from "hono";
import type { betsRepo } from "../infrastructure/database/repositories/bets";
import type { competitorVersionsRepo } from "../infrastructure/database/repositories/competitor-versions";
import type { competitorsRepo } from "../infrastructure/database/repositories/competitors";
import type { fixturesRepo } from "../infrastructure/database/repositories/fixtures";
import type { marketsRepo } from "../infrastructure/database/repositories/markets";
import type { predictionsRepo } from "../infrastructure/database/repositories/predictions";
import type { walletsRepo } from "../infrastructure/database/repositories/wallets";
import { betsRoutes } from "./routes/bets";
import { competitorsRoutes } from "./routes/competitors";
import { dashboardRoutes } from "./routes/dashboard";
import { fixturesRoutes } from "./routes/fixtures";
import { marketsRoutes } from "./routes/markets";
import { predictionsRoutes } from "./routes/predictions";

export type ApiDeps = {
  competitorsRepo: ReturnType<typeof competitorsRepo>;
  competitorVersionsRepo: ReturnType<typeof competitorVersionsRepo>;
  betsRepo: ReturnType<typeof betsRepo>;
  predictionsRepo: ReturnType<typeof predictionsRepo>;
  marketsRepo: ReturnType<typeof marketsRepo>;
  fixturesRepo: ReturnType<typeof fixturesRepo>;
  walletsRepo: ReturnType<typeof walletsRepo>;
};

export function createApi(deps: ApiDeps) {
  const app = new Hono();

  app.route("/api", dashboardRoutes(deps));
  app.route("/api", competitorsRoutes(deps));
  app.route("/api", fixturesRoutes(deps));
  app.route("/api", marketsRoutes(deps));
  app.route("/api", betsRoutes(deps));
  app.route("/api", predictionsRoutes(deps));

  return app;
}
