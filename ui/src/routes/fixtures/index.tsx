import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/shared/empty-state";
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

export function FixturesPage() {
  const [status, setStatus] = useState("");
  const { data, isLoading } = useFixtures(status || undefined);

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
      ) : !data || data.length === 0 ? (
        <EmptyState message="No fixtures found" />
      ) : (
        <div className="rounded-md border border-zinc-800 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Date</TableHead>
                <TableHead className="text-zinc-400">Match</TableHead>
                <TableHead className="text-zinc-400">League</TableHead>
                <TableHead className="text-zinc-400">Venue</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="text-zinc-400 text-right">Markets</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((f) => (
                <TableRow key={f.id} className="border-zinc-800 hover:bg-zinc-800/50">
                  <TableCell className="text-zinc-400 text-sm">{formatDate(f.date)}</TableCell>
                  <TableCell>
                    <Link
                      to="/fixtures/$id"
                      params={{ id: String(f.id) }}
                      className="text-zinc-100 hover:text-emerald-400 transition-colors font-medium"
                    >
                      {f.homeTeamName} vs {f.awayTeamName}
                    </Link>
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
