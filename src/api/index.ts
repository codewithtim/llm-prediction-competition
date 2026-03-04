import { Hono } from "hono";
import type { betsRepo } from "../database/repositories/bets";
import type { competitorVersionsRepo } from "../database/repositories/competitor-versions";
import type { competitorsRepo } from "../database/repositories/competitors";
import type { fixturesRepo } from "../database/repositories/fixtures";
import type { marketsRepo } from "../database/repositories/markets";
import type { predictionsRepo } from "../database/repositories/predictions";
import type { walletsRepo } from "../database/repositories/wallets";
import type { BankrollProvider } from "../domain/services/bankroll";
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
  bankrollProvider: BankrollProvider;
  initialBankroll: number;
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
