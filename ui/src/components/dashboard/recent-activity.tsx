import type { BetSummary } from "@shared/api-types";
import { Link, useNavigate } from "@tanstack/react-router";
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
import { formatDateTime, formatPct } from "@/lib/format";

export function RecentActivity({ bets }: { bets: BetSummary[] }) {
  const navigate = useNavigate();
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-zinc-400">Recent Bets</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {bets.length === 0 ? (
          <p className="text-zinc-500 text-sm py-4 text-center">No bets yet</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Competitor</TableHead>
                <TableHead className="text-zinc-400">Market</TableHead>
                <TableHead className="text-zinc-400">Side</TableHead>
                <TableHead className="text-zinc-400 text-right">Confidence</TableHead>
                <TableHead className="text-zinc-400 text-right">Price</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="text-zinc-400">Placed</TableHead>
                <TableHead className="text-zinc-400 text-right">P&L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bets.map((bet) => (
                <TableRow
                  key={bet.id}
                  className="border-zinc-800 hover:bg-zinc-800/50 cursor-pointer"
                  onClick={() => navigate({ to: "/bets/$id", params: { id: bet.id } })}
                >
                  <TableCell className="text-zinc-200 font-medium">{bet.competitorName}</TableCell>
                  <TableCell className="text-sm max-w-48 truncate">
                    <Link
                      to="/bets/$id"
                      params={{ id: bet.id }}
                      className="text-zinc-100 hover:text-emerald-400 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {bet.marketQuestion}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-zinc-300">{bet.side}</TableCell>
                  <TableCell className="text-right font-mono text-zinc-300">
                    {bet.confidence != null ? formatPct(bet.confidence) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-zinc-300">
                    {bet.price.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={bet.status} />
                  </TableCell>
                  <TableCell className="text-zinc-400 text-sm">
                    {formatDateTime(bet.placedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={bet.profit} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
