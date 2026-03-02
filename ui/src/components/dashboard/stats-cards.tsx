import { StatCard } from "@/components/shared/stat-card";
import { formatCurrency, formatPct } from "@/lib/format";
import type { DashboardResponse } from "@shared/api-types";

export function StatsCards({ data }: { data: DashboardResponse }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Total P&L"
        value={formatCurrency(data.totalProfitLoss)}
        valueClassName={data.totalProfitLoss >= 0 ? "text-emerald-400" : "text-red-400"}
        subtitle={`${data.totalBets} total bets`}
      />
      <StatCard
        title="Accuracy"
        value={formatPct(data.overallAccuracy)}
        subtitle={`Across ${data.activeCompetitors} active competitors`}
      />
      <StatCard
        title="Active Markets"
        value={String(data.activeMarkets)}
        subtitle={`${data.totalMarkets} total markets`}
      />
      <StatCard
        title="Pending Bets"
        value={String(data.pendingBets)}
        subtitle={`${data.totalFixtures} fixtures tracked`}
      />
    </div>
  );
}
