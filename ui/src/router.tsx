import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { Sidebar } from "@/components/layout/sidebar";
import { BetsPage } from "@/routes/bets/index";
import { CompetitorDetailPage } from "@/routes/competitors/$id";
import { CompetitorsPage } from "@/routes/competitors/index";
import { FixtureDetailPage } from "@/routes/fixtures/$id";
import { FixturesPage } from "@/routes/fixtures/index";
import { DashboardPage } from "@/routes/index";
import { MarketsPage } from "@/routes/markets/index";

const rootRoute = createRootRoute({
  component: () => (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar />
      <main className="ml-64 flex-1 p-8">
        <Outlet />
      </main>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});

const competitorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/competitors",
  component: CompetitorsPage,
});

const competitorDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/competitors/$id",
  component: CompetitorDetailPage,
});

const fixturesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/fixtures",
  component: FixturesPage,
});

const fixtureDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/fixtures/$id",
  component: FixtureDetailPage,
});

const marketsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/markets",
  component: MarketsPage,
});

const betsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bets",
  component: BetsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  competitorsRoute,
  competitorDetailRoute,
  fixturesRoute,
  fixtureDetailRoute,
  marketsRoute,
  betsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
