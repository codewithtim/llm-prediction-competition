import { Link, useParams } from "@tanstack/react-router";
import { PageShell } from "@/components/layout/page-shell";
import { ExternalLink } from "@/components/shared/external-link";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { ReasoningSections } from "@/components/shared/reasoning-sections";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBet } from "@/lib/api";
import { ERROR_CATEGORIES } from "@/lib/constants";
import { formatCurrency, formatDateTime, formatPct } from "@/lib/format";

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2 border-b border-zinc-800 last:border-0">
      <span className="text-sm text-zinc-400">{label}</span>
      <span className="text-sm text-zinc-200">{children}</span>
    </div>
  );
}

export function BetDetailPage() {
  const { id } = useParams({ from: "/bets/$id" });
  const { data, isLoading } = useBet(id);

  if (isLoading || !data) return <LoadingSkeleton />;

  return (
    <PageShell
      title={data.marketQuestion}
      subtitle={`${data.competitorName} | ${formatDateTime(data.placedAt)}`}
    >
      <div className="flex items-center gap-3 -mt-4">
        <StatusBadge status={data.status} />
        <ExternalLink href={data.polymarketUrl}>View on Polymarket</ExternalLink>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Amount" value={`$${data.amount.toFixed(2)}`} />
        <StatCard title="Price" value={data.price.toFixed(2)} />
        <StatCard
          title="Confidence"
          value={data.confidence != null ? formatPct(data.confidence) : "—"}
        />
        <StatCard
          title="P&L"
          value={data.profit != null ? formatCurrency(data.profit) : "Pending"}
          valueClassName={
            data.profit != null
              ? data.profit >= 0
                ? "text-emerald-400"
                : "text-red-400"
              : "text-zinc-400"
          }
        />
      </div>

      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-zinc-400">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailRow label="Competitor">
            <Link
              to="/competitors/$id"
              params={{ id: data.competitorId }}
              className="text-zinc-100 hover:text-emerald-400 transition-colors"
            >
              {data.competitorName}
            </Link>
          </DetailRow>
          {data.fixtureSummary && (
            <DetailRow label="Fixture">
              <Link
                to="/fixtures/$id"
                params={{ id: String(data.fixtureId) }}
                className="text-zinc-100 hover:text-emerald-400 transition-colors"
              >
                {data.fixtureSummary}
              </Link>
            </DetailRow>
          )}
          <DetailRow label="Side">
            <span className="font-mono">{data.side}</span>
          </DetailRow>
          <DetailRow label="Shares">
            <span className="font-mono">{data.shares.toFixed(4)}</span>
          </DetailRow>
          {data.orderId && (
            <DetailRow label="Order ID">
              <span className="font-mono text-xs">{data.orderId}</span>
            </DetailRow>
          )}
          <DetailRow label="Placed">{formatDateTime(data.placedAt)}</DetailRow>
          {data.settledAt && (
            <DetailRow label="Settled">{formatDateTime(data.settledAt)}</DetailRow>
          )}
          {data.attempts > 0 && (
            <DetailRow label="Attempts">
              <span className="font-mono">{data.attempts}</span>
            </DetailRow>
          )}
          {data.lastAttemptAt && (
            <DetailRow label="Last Attempt">{formatDateTime(data.lastAttemptAt)}</DetailRow>
          )}
        </CardContent>
      </Card>

      {data.status === "failed" && (data.errorCategory || data.errorMessage) && (
        <Card className="bg-zinc-900 border-red-900/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-red-400">Error</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.errorCategory && (
              <Badge
                variant="outline"
                className={`${(ERROR_CATEGORIES[data.errorCategory] ?? ERROR_CATEGORIES.unknown).className} text-xs font-medium`}
              >
                {ERROR_CATEGORIES[data.errorCategory]?.label ?? data.errorCategory}
              </Badge>
            )}
            {data.errorMessage && (
              <p className="text-sm text-zinc-400 font-mono">{data.errorMessage}</p>
            )}
          </CardContent>
        </Card>
      )}

      {data.reasoning && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-400">
              Prediction Reasoning
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-300 mb-4">{data.reasoning.summary}</p>
            <ReasoningSections reasoning={data.reasoning} />
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
