import { useParams } from "@tanstack/react-router";
import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { ModelLogo } from "@/components/shared/model-logo";
import { Money } from "@/components/shared/money";
import { ReasoningCell } from "@/components/shared/reasoning-modal";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompetitor } from "@/lib/api";
import { formatCurrency, formatDateTime, formatPct } from "@/lib/format";

export function CompetitorDetailPage() {
  const { id } = useParams({ from: "/competitors/$id" });
  const { data, isLoading } = useCompetitor(id);

  if (isLoading || !data) return <LoadingSkeleton />;

  return (
    <PageShell
      title={data.name}
      subtitle={`${data.model} | ${data.type}${data.hasWallet ? " | Wallet connected" : ""}`}
    >
      <div className="flex items-center gap-3 -mt-4">
        <ModelLogo model={data.model} size="md" />
        <StatusBadge status={data.status} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="P&L"
          value={formatCurrency(data.stats.profitLoss)}
          valueClassName={data.stats.profitLoss >= 0 ? "text-emerald-400" : "text-red-400"}
        />
        <StatCard title="Total Bets" value={String(data.stats.totalBets)} />
        <StatCard title="Accuracy" value={formatPct(data.stats.accuracy)} />
        <StatCard title="ROI" value={formatPct(data.stats.roi)} />
      </div>

      <Tabs defaultValue="bets" className="w-full">
        <TabsList className="bg-zinc-900 border border-zinc-800">
          <TabsTrigger value="bets">Bets ({data.recentBets.length})</TabsTrigger>
          <TabsTrigger value="predictions">
            Predictions ({data.recentPredictions.length})
          </TabsTrigger>
          <TabsTrigger value="versions">Versions ({data.versions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="bets">
          {data.recentBets.length === 0 ? (
            <EmptyState message="No bets placed yet" />
          ) : (
            <div className="rounded-md border border-zinc-800 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-400">Market</TableHead>
                    <TableHead className="text-zinc-400">Side</TableHead>
                    <TableHead className="text-zinc-400 text-right">Amount</TableHead>
                    <TableHead className="text-zinc-400 text-right">Price</TableHead>
                    <TableHead className="text-zinc-400">Status</TableHead>
                    <TableHead className="text-zinc-400">Placed</TableHead>
                    <TableHead className="text-zinc-400 text-right">Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentBets.map((b) => (
                    <TableRow key={b.id} className="border-zinc-800 hover:bg-zinc-800/50">
                      <TableCell className="text-zinc-200 max-w-64 truncate">
                        {b.marketQuestion}
                      </TableCell>
                      <TableCell className="font-mono text-zinc-300">{b.side}</TableCell>
                      <TableCell className="text-right font-mono text-zinc-300">
                        ${b.amount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-zinc-300">
                        {b.price.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={b.status} />
                      </TableCell>
                      <TableCell className="text-zinc-400 text-sm">
                        {formatDateTime(b.placedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={b.profit} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="predictions">
          {data.recentPredictions.length === 0 ? (
            <EmptyState message="No predictions yet" />
          ) : (
            <div className="rounded-md border border-zinc-800 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-400">Market</TableHead>
                    <TableHead className="text-zinc-400">Side</TableHead>
                    <TableHead className="text-zinc-400 text-right">Confidence</TableHead>
                    <TableHead className="text-zinc-400 text-right">Stake</TableHead>
                    <TableHead className="text-zinc-400">Reasoning</TableHead>
                    <TableHead className="text-zinc-400">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentPredictions.map((p) => (
                    <TableRow key={p.id} className="border-zinc-800 hover:bg-zinc-800/50">
                      <TableCell className="text-zinc-200 max-w-48 truncate">
                        {p.marketQuestion}
                      </TableCell>
                      <TableCell className="font-mono text-zinc-300">{p.side}</TableCell>
                      <TableCell className="text-right font-mono text-zinc-300">
                        {formatPct(p.confidence)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-zinc-300">
                        ${p.stake.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-sm">
                        <ReasoningCell reasoning={p.reasoning} market={p.marketQuestion} />
                      </TableCell>
                      <TableCell className="text-zinc-400 text-sm">
                        {formatDateTime(p.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="versions">
          {data.versions.length === 0 ? (
            <EmptyState message="No versions yet" />
          ) : (
            <div className="rounded-md border border-zinc-800 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-400">Version</TableHead>
                    <TableHead className="text-zinc-400">Model</TableHead>
                    <TableHead className="text-zinc-400">Engine Path</TableHead>
                    <TableHead className="text-zinc-400">Generated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.versions.map((v) => (
                    <TableRow key={v.id} className="border-zinc-800 hover:bg-zinc-800/50">
                      <TableCell className="font-mono text-zinc-300">v{v.version}</TableCell>
                      <TableCell className="text-zinc-400">{v.model}</TableCell>
                      <TableCell className="text-zinc-400 text-sm font-mono">
                        {v.enginePath}
                      </TableCell>
                      <TableCell className="text-zinc-400 text-sm">
                        {formatDateTime(v.generatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
