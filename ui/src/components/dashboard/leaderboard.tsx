import type { LeaderboardEntry } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPct } from "@/lib/format";

export function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-zinc-400">Leaderboard</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-zinc-400 w-12">#</TableHead>
              <TableHead className="text-zinc-400">Competitor</TableHead>
              <TableHead className="text-zinc-400">Status</TableHead>
              <TableHead className="text-zinc-400 text-right">Bets</TableHead>
              <TableHead className="text-zinc-400 text-right">W/L</TableHead>
              <TableHead className="text-zinc-400 text-right">Accuracy</TableHead>
              <TableHead className="text-zinc-400 text-right">P&L</TableHead>
              <TableHead className="text-zinc-400 text-right">ROI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.competitor.id} className="border-zinc-800 hover:bg-zinc-800/50">
                <TableCell className="font-mono text-zinc-500">{entry.rank}</TableCell>
                <TableCell>
                  <Link
                    to="/competitors/$id"
                    params={{ id: entry.competitor.id }}
                    className="text-zinc-100 hover:text-emerald-400 transition-colors"
                  >
                    {entry.competitor.name}
                  </Link>
                  <div className="text-xs text-zinc-500">{entry.competitor.model}</div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={entry.competitor.status} />
                </TableCell>
                <TableCell className="text-right font-mono text-zinc-300">
                  {entry.competitor.stats.totalBets}
                </TableCell>
                <TableCell className="text-right font-mono text-zinc-300">
                  {entry.competitor.stats.wins}/{entry.competitor.stats.losses}
                </TableCell>
                <TableCell className="text-right font-mono text-zinc-300">
                  {formatPct(entry.competitor.stats.accuracy)}
                </TableCell>
                <TableCell className="text-right">
                  <Money value={entry.competitor.stats.profitLoss} />
                </TableCell>
                <TableCell className="text-right font-mono text-zinc-300">
                  {formatPct(entry.competitor.stats.roi)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
