import { useParams } from "@tanstack/react-router";
import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { ExternalLink } from "@/components/shared/external-link";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { ReasoningCell } from "@/components/shared/reasoning-modal";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFixture } from "@/lib/api";
import { formatDate, formatPct } from "@/lib/format";

export function FixtureDetailPage() {
  const { id } = useParams({ from: "/fixtures/$id" });
  const { data, isLoading } = useFixture(Number(id));

  if (isLoading || !data) return <LoadingSkeleton />;

  return (
    <PageShell
      title={`${data.homeTeamName} vs ${data.awayTeamName}`}
      subtitle={`${data.leagueName} | ${formatDate(data.date)} | ${data.venue ?? "TBD"}`}
    >
      <div className="flex items-center gap-3 -mt-4">
        <StatusBadge status={data.status} />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-zinc-200 mb-3">
          Markets ({data.markets.length})
        </h2>
        {data.markets.length === 0 ? (
          <EmptyState message="No markets for this fixture" />
        ) : (
          <div className="rounded-md border border-zinc-800 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">Question</TableHead>
                  <TableHead className="text-zinc-400 text-right">Yes Price</TableHead>
                  <TableHead className="text-zinc-400 text-right">No Price</TableHead>
                  <TableHead className="text-zinc-400 text-right">Liquidity</TableHead>
                  <TableHead className="text-zinc-400 text-right">Volume</TableHead>
                  <TableHead className="text-zinc-400">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.markets.map((m) => (
                  <TableRow key={m.id} className="border-zinc-800 hover:bg-zinc-800/50">
                    <TableCell className="text-zinc-200">
                      <ExternalLink href={m.polymarketUrl}>{m.question}</ExternalLink>
                    </TableCell>
                    <TableCell className="text-right font-mono text-zinc-300">
                      {Number(m.outcomePrices[0]).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-zinc-300">
                      {Number(m.outcomePrices[1]).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-zinc-300">
                      ${m.liquidity.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-zinc-300">
                      ${m.volume.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-zinc-200 mb-3">
          Predictions ({data.predictions.length})
        </h2>
        {data.predictions.length === 0 ? (
          <EmptyState message="No predictions for this fixture" />
        ) : (
          <div className="rounded-md border border-zinc-800 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">Competitor</TableHead>
                  <TableHead className="text-zinc-400">Market</TableHead>
                  <TableHead className="text-zinc-400">Side</TableHead>
                  <TableHead className="text-zinc-400 text-right">Confidence</TableHead>
                  <TableHead className="text-zinc-400 text-right">Stake</TableHead>
                  <TableHead className="text-zinc-400">Reasoning</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.predictions.map((p) => (
                  <TableRow key={p.id} className="border-zinc-800 hover:bg-zinc-800/50">
                    <TableCell className="text-zinc-200">{p.competitorName}</TableCell>
                    <TableCell className="text-zinc-400 text-sm max-w-48 truncate">
                      <ExternalLink href={p.polymarketUrl}>{p.marketQuestion}</ExternalLink>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </PageShell>
  );
}
