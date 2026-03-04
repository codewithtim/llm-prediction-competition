import type { ReasoningDTO } from "@shared/api-types";
import { Link, useParams } from "@tanstack/react-router";
import { Fragment } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { ExternalLink } from "@/components/shared/external-link";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { Money } from "@/components/shared/money";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useBet } from "@/lib/api";
import { formatCurrency, formatDateTime, formatPct } from "@/lib/format";

const ERROR_CATEGORIES: Record<string, { label: string; className: string }> = {
  insufficient_funds: {
    label: "Insufficient Funds",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  network_error: {
    label: "Network Error",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  rate_limited: {
    label: "Rate Limited",
    className: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  },
  wallet_error: {
    label: "Wallet Error",
    className: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  },
  invalid_market: {
    label: "Invalid Market",
    className: "bg-pink-500/15 text-pink-400 border-pink-500/30",
  },
  unknown: {
    label: "Unknown Error",
    className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  },
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2 border-b border-zinc-800 last:border-0">
      <span className="text-sm text-zinc-400">{label}</span>
      <span className="text-sm text-zinc-200">{children}</span>
    </div>
  );
}

function ReasoningInline({ reasoning }: { reasoning: ReasoningDTO }) {
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-zinc-400">Prediction Reasoning</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-300">{reasoning.summary}</p>
        {reasoning.sections.map((section, i) => (
          <Fragment key={section.label}>
            {i > 0 && <Separator className="bg-zinc-800" />}
            <div>
              <h4 className="text-sm font-medium text-zinc-200 mb-1">{section.label}</h4>
              {section.data && Object.keys(section.data).length > 0 ? (
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
                  {Object.entries(section.data).map(([k, v]) => (
                    <Fragment key={k}>
                      <span className="text-zinc-500">{k}</span>
                      <span className="text-zinc-300">
                        {typeof v === "number" ? v.toFixed(4) : String(v)}
                      </span>
                    </Fragment>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-400 leading-relaxed">{section.content}</p>
              )}
            </div>
          </Fragment>
        ))}
      </CardContent>
    </Card>
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

      {data.reasoning && <ReasoningInline reasoning={data.reasoning} />}
    </PageShell>
  );
}
