import type { DashboardResponse } from "@shared/api-types";
import { StatCard } from "@/components/shared/stat-card";
import { formatCurrency, formatPct } from "@/lib/format";

export function StatsCards({ data }: { data: DashboardResponse }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      <StatCard
        title="Settled P&L"
        value={formatCurrency(data.totalProfitLoss)}
        valueClassName={data.totalProfitLoss >= 0 ? "text-emerald-400" : "text-red-400"}
        subtitle={`${data.totalBets} total bets`}
      />
      <StatCard
        title="Locked in Bets"
        value={formatCurrency(data.lockedAmount)}
        valueClassName={data.lockedAmount > 0 ? "text-amber-400" : "text-zinc-100"}
        subtitle={`${data.pendingBets} active orders`}
      />
      <StatCard
        title="Accuracy"
        value={formatPct(data.overallAccuracy)}
        subtitle={`${data.activeCompetitors} competitors`}
      />
      <StatCard
        title="Active Markets"
        value={String(data.activeMarkets)}
        subtitle={`${data.totalMarkets} total`}
      />
      <StatCard
        title="Pending Bets"
        value={String(data.pendingBets)}
        subtitle={`${data.totalFixtures} fixtures`}
      />
      <StatCard
        title="Failed Bets"
        value={String(data.failedBets)}
        valueClassName={data.failedBets > 0 ? "text-red-400" : "text-zinc-100"}
        subtitle={data.failedBets > 0 ? "Check bet errors" : "All clear"}
      />
    </div>
  );
}
