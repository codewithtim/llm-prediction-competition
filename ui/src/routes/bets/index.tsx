import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { InternalLink } from "@/components/shared/internal-link";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBets } from "@/lib/api";
import { ERROR_CATEGORIES } from "@/lib/constants";
import { formatDateTime, formatPct } from "@/lib/format";

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "filled", label: "Filled" },
  { value: "settled_won", label: "Won" },
  { value: "settled_lost", label: "Lost" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

export function BetsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [errorCategory, setErrorCategory] = useState("");
  const filters: { status?: string; errorCategory?: string } = {};
  if (status) filters.status = status;
  if (status === "failed" && errorCategory) filters.errorCategory = errorCategory;
  const { data, isLoading } = useBets(Object.keys(filters).length > 0 ? filters : undefined);

  return (
    <PageShell title="Bets" subtitle="All bets placed by competitors">
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setErrorCategory("");
          }}
        >
          <TabsList className="bg-zinc-900 border border-zinc-800">
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {status === "failed" && (
          <Select value={errorCategory} onValueChange={setErrorCategory}>
            <SelectTrigger className="w-48 bg-zinc-900 border-zinc-800 text-zinc-300">
              <SelectValue placeholder="All reasons" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ERROR_CATEGORIES).map(([value, { label }]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : !data || data.length === 0 ? (
        <EmptyState message="No bets found" />
      ) : (
        <div className="rounded-md border border-zinc-800 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Competitor</TableHead>
                <TableHead className="text-zinc-400">Market</TableHead>
                <TableHead className="text-zinc-400">Side</TableHead>
                <TableHead className="text-zinc-400 text-right">Confidence</TableHead>
                <TableHead className="text-zinc-400 text-right">Amount</TableHead>
                <TableHead className="text-zinc-400 text-right">Price</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="text-zinc-400">Error</TableHead>
                <TableHead className="text-zinc-400">Placed</TableHead>
                <TableHead className="text-zinc-400 text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((b) => (
                <TableRow
                  key={b.id}
                  className="border-zinc-800 hover:bg-zinc-800/50 cursor-pointer"
                  onClick={() => navigate({ to: "/bets/$id", params: { id: b.id } })}
                >
                  <TableCell className="text-zinc-200 font-medium">{b.competitorName}</TableCell>
                  <TableCell className="text-sm max-w-64 truncate">
                    <InternalLink
                      to="/bets/$id"
                      params={{ id: b.id }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {b.marketQuestion}
                    </InternalLink>
                  </TableCell>
                  <TableCell className="font-mono text-zinc-300">{b.side}</TableCell>
                  <TableCell className="text-right font-mono text-zinc-300">
                    {b.confidence != null ? formatPct(b.confidence) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-zinc-300">
                    ${b.amount.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-zinc-300">
                    {b.price.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={b.status} />
                  </TableCell>
                  <TableCell>
                    {b.status === "failed" && b.errorCategory && (
                      <Badge
                        variant="outline"
                        className={`${(ERROR_CATEGORIES[b.errorCategory] ?? ERROR_CATEGORIES.unknown).className} text-xs font-medium`}
                        title={b.errorMessage ?? undefined}
                      >
                        {ERROR_CATEGORIES[b.errorCategory]?.label ?? b.errorCategory}
                      </Badge>
                    )}
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
    </PageShell>
  );
}
