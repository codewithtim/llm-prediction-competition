import { Leaderboard } from "@/components/dashboard/leaderboard";
import { PnlChart } from "@/components/dashboard/pnl-chart";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { PageShell } from "@/components/layout/page-shell";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { useDashboard } from "@/lib/api";

export function DashboardPage() {
  const { data, isLoading } = useDashboard();

  if (isLoading || !data) return <LoadingSkeleton />;

  return (
    <PageShell title="Dashboard" subtitle="Overview of the LLM betting competition">
      <StatsCards data={data} />
      <PnlChart entries={data.leaderboard} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Leaderboard entries={data.leaderboard} />
        <RecentActivity bets={data.recentBets} />
      </div>
    </PageShell>
  );
}
