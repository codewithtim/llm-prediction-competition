import { Link } from "@tanstack/react-router";
import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { ModelLogo } from "@/components/shared/model-logo";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCompetitors } from "@/lib/api";
import { formatPct } from "@/lib/format";

export function CompetitorsPage() {
  const { data, isLoading } = useCompetitors();

  return (
    <PageShell title="Competitors" subtitle="All registered LLM competitors">
      {isLoading ? (
        <TableSkeleton />
      ) : !data || data.length === 0 ? (
        <EmptyState message="No competitors registered" />
      ) : (
        <div className="rounded-md border border-zinc-800 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Name</TableHead>
                <TableHead className="text-zinc-400">Model</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="text-zinc-400 text-right">Bets</TableHead>
                <TableHead className="text-zinc-400 text-right">W/L</TableHead>
                <TableHead className="text-zinc-400 text-right">P&L</TableHead>
                <TableHead className="text-zinc-400 text-right">ROI</TableHead>
                <TableHead className="text-zinc-400 text-right">Accuracy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((c) => (
                <TableRow key={c.id} className="border-zinc-800 hover:bg-zinc-800/50">
                  <TableCell>
                    <Link
                      to="/competitors/$id"
                      params={{ id: c.id }}
                      className="text-zinc-100 hover:text-emerald-400 transition-colors font-medium"
                    >
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2 text-zinc-400 text-sm">
                      <ModelLogo model={c.model} />
                      {c.model}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-zinc-300">
                    {c.stats.totalBets}
                  </TableCell>
                  <TableCell className="text-right font-mono text-zinc-300">
                    {c.stats.wins}/{c.stats.losses}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={c.stats.profitLoss} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-zinc-300">
                    {formatPct(c.stats.roi)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-zinc-300">
                    {formatPct(c.stats.accuracy)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageShell>
  );
}
