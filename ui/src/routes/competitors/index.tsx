import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { InternalLink } from "@/components/shared/internal-link";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { ModelLogo } from "@/components/shared/model-logo";
import { Money } from "@/components/shared/money";
import { SortableHeader } from "@/components/shared/sortable-header";
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
import { useSort } from "@/lib/use-sort";

type CompetitorSortKey = "name" | "bets" | "wins" | "pnl" | "roi" | "accuracy" | "balance";

export function CompetitorsPage() {
  const { data, isLoading } = useCompetitors();

  const { sorted, sort, toggle } = useSort(
    data,
    { key: "pnl" as CompetitorSortKey, direction: "desc" },
    {
      name: (c) => c.name,
      bets: (c) => c.stats.totalBets,
      wins: (c) => c.stats.wins,
      pnl: (c) => c.stats.profitLoss,
      roi: (c) => c.stats.roi,
      accuracy: (c) => c.stats.accuracy,
      balance: (c) => c.onChainBalance,
    },
  );

  const header = (label: string, key: CompetitorSortKey, className = "") => (
    <SortableHeader
      label={label}
      sortKey={key}
      currentKey={sort.key}
      direction={sort.direction}
      onSort={(k) => toggle(k as CompetitorSortKey)}
      className={className}
    />
  );

  return (
    <PageShell title="Competitors" subtitle="All registered LLM competitors">
      {isLoading ? (
        <TableSkeleton />
      ) : !sorted || sorted.length === 0 ? (
        <EmptyState message="No competitors registered" />
      ) : (
        <div className="rounded-md border border-zinc-800 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                {header("Name", "name")}
                <TableHead className="text-zinc-400">Model</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                {header("Bets", "bets", "text-right")}
                {header("W/L", "wins", "text-right")}
                {header("P&L", "pnl", "text-right")}
                {header("ROI", "roi", "text-right")}
                {header("Accuracy", "accuracy", "text-right")}
                {header("Balance", "balance", "text-right")}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((c) => (
                <TableRow key={c.id} className="border-zinc-800 hover:bg-zinc-800/50">
                  <TableCell>
                    <InternalLink
                      to="/competitors/$id"
                      params={{ id: c.id }}
                      className="font-medium"
                    >
                      {c.name}
                    </InternalLink>
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
                  <TableCell className="text-right font-mono text-zinc-300">
                    {c.onChainBalance != null ? `$${c.onChainBalance.toFixed(2)}` : "—"}
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
