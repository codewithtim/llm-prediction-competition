import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { Sidebar } from "@/components/layout/sidebar";
import { useSidebar } from "@/components/layout/sidebar-context";
import { AboutPage } from "@/routes/about/index";
import { BetDetailPage } from "@/routes/bets/$id";
import { BetsPage } from "@/routes/bets/index";
import { CompetitorDetailPage } from "@/routes/competitors/$id";
import { VersionDetailPage } from "@/routes/competitors/$id.versions.$version";
import { CompetitorsPage } from "@/routes/competitors/index";
import { FixtureDetailPage } from "@/routes/fixtures/$id";
import { FixturesPage } from "@/routes/fixtures/index";
import { DashboardPage } from "@/routes/index";
import { MarketsPage } from "@/routes/markets/index";

function RootLayout() {
  const { collapsed } = useSidebar();
  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar />
      <main
        className={`flex-1 p-8 transition-[margin] duration-200 ${collapsed ? "ml-16" : "ml-64"}`}
      >
        <Outlet />
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
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

const versionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/competitors/$id/versions/$version",
  component: VersionDetailPage,
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

const betDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bets/$id",
  component: BetDetailPage,
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
  component: AboutPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  competitorsRoute,
  competitorDetailRoute,
  versionDetailRoute,
  fixturesRoute,
  fixtureDetailRoute,
  marketsRoute,
  betsRoute,
  betDetailRoute,
  aboutRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
