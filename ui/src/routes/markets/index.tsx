import { useMemo, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { ExternalLink } from "@/components/shared/external-link";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMarkets } from "@/lib/api";

const FILTER_TABS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
];

type SortField = "liquidity" | "volume";
type SortDir = "asc" | "desc";

export function MarketsPage() {
  const [filter, setFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("liquidity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const filters =
    filter === "active" ? { active: "true" } : filter === "closed" ? { closed: "true" } : undefined;
  const { data, isLoading } = useMarkets(filters);

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => {
      const va = a[sortField];
      const vb = b[sortField];
      return sortDir === "asc" ? va - vb : vb - va;
    });
  }, [data, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function sortIndicator(field: SortField) {
    if (sortField !== field) return "\u21C5";
    return sortDir === "asc" ? "\u2191" : "\u2193";
  }

  return (
    <PageShell title="Markets" subtitle="Polymarket prediction markets">
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList className="bg-zinc-900 border border-zinc-800">
          {FILTER_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <TableSkeleton />
      ) : sorted.length === 0 ? (
        <EmptyState message="No markets found" />
      ) : (
        <div className="rounded-md border border-zinc-800 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Question</TableHead>
                <TableHead className="text-zinc-400 text-right">Yes</TableHead>
                <TableHead className="text-zinc-400 text-right">No</TableHead>
                <TableHead
                  className="text-zinc-400 text-right cursor-pointer select-none hover:text-zinc-200 transition-colors"
                  onClick={() => handleSort("liquidity")}
                >
                  <span className="inline-flex items-center justify-end gap-1">
                    Liquidity
                    <span className="text-xs">{sortIndicator("liquidity")}</span>
                  </span>
                </TableHead>
                <TableHead
                  className="text-zinc-400 text-right cursor-pointer select-none hover:text-zinc-200 transition-colors"
                  onClick={() => handleSort("volume")}
                >
                  <span className="inline-flex items-center justify-end gap-1">
                    Volume
                    <span className="text-xs">{sortIndicator("volume")}</span>
                  </span>
                </TableHead>
                <TableHead className="text-zinc-400">Fixture</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((m) => (
                <TableRow key={m.id} className="border-zinc-800 hover:bg-zinc-800/50">
                  <TableCell className="text-zinc-200 max-w-72 truncate">
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
                  <TableCell className="text-zinc-400 text-sm max-w-48 truncate">
                    {m.fixtureSummary ?? "--"}
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
    </PageShell>
  );
}
