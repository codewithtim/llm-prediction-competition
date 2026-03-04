import { useMemo, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { InternalLink } from "@/components/shared/internal-link";
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
import { useFixtures } from "@/lib/api";
import { formatDate } from "@/lib/format";

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
  { value: "finished", label: "Finished" },
];

type SortDir = "asc" | "desc";

export function FixturesPage() {
  const [status, setStatus] = useState("");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const { data, isLoading } = useFixtures(status || undefined);

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      return sortDir === "asc" ? da - db : db - da;
    });
  }, [data, sortDir]);

  return (
    <PageShell title="Fixtures" subtitle="Football fixtures tracked by the system">
      <Tabs value={status} onValueChange={setStatus}>
        <TabsList className="bg-zinc-900 border border-zinc-800">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <TableSkeleton />
      ) : sorted.length === 0 ? (
        <EmptyState message="No fixtures found" />
      ) : (
        <div className="rounded-md border border-zinc-800 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead
                  className="text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors"
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                >
                  <span className="inline-flex items-center gap-1">
                    Date
                    <span className="text-xs">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
                  </span>
                </TableHead>
                <TableHead className="text-zinc-400">Match</TableHead>
                <TableHead className="text-zinc-400">League</TableHead>
                <TableHead className="text-zinc-400">Venue</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="text-zinc-400 text-right">Markets</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((f) => (
                <TableRow key={f.id} className="border-zinc-800 hover:bg-zinc-800/50">
                  <TableCell className="text-zinc-400 text-sm">{formatDate(f.date)}</TableCell>
                  <TableCell>
                    <InternalLink
                      to="/fixtures/$id"
                      params={{ id: String(f.id) }}
                      className="font-medium"
                    >
                      {f.homeTeamName} vs {f.awayTeamName}
                    </InternalLink>
                  </TableCell>
                  <TableCell className="text-zinc-400 text-sm">
                    {f.leagueName} ({f.leagueCountry})
                  </TableCell>
                  <TableCell className="text-zinc-400 text-sm">{f.venue ?? "--"}</TableCell>
                  <TableCell>
                    <StatusBadge status={f.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-zinc-300">
                    {f.marketCount}
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
