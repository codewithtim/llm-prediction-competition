import type { BetSummary } from "@shared/api-types";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatPct } from "@/lib/format";

export function RecentActivity({ bets }: { bets: BetSummary[] }) {
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-zinc-400">Recent Bets</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {bets.length === 0 ? (
          <p className="text-zinc-500 text-sm py-4 text-center">No bets yet</p>
        ) : (
          bets.map((bet) => (
            <div
              key={bet.id}
              className="flex items-center justify-between border-b border-zinc-800 pb-3 last:border-0"
            >
              <div className="space-y-1">
                <div className="text-sm text-zinc-200">{bet.competitorName}</div>
                <div className="text-xs text-zinc-500 line-clamp-1">{bet.marketQuestion}</div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="font-mono">{bet.side}</span>
                  {bet.confidence != null && (
                    <span className="font-mono">{formatPct(bet.confidence)}</span>
                  )}
                  <span>@ ${bet.price.toFixed(2)}</span>
                  <span>{formatDateTime(bet.placedAt)}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={bet.status} />
                <Money value={bet.profit} />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
