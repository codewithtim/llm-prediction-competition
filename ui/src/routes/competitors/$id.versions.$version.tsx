import { useParams } from "@tanstack/react-router";
import { PageShell } from "@/components/layout/page-shell";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useVersion } from "@/lib/api";
import { formatCurrency, formatDateTime, formatPct } from "@/lib/format";

export function VersionDetailPage() {
  const { id, version } = useParams({ from: "/competitors/$id/versions/$version" });
  const { data, isLoading } = useVersion(id, Number(version));

  if (isLoading || !data) return <LoadingSkeleton />;

  const { signals, ...globalParams } = data.weights as {
    signals?: Record<string, number>;
    [key: string]: unknown;
  };

  return (
    <PageShell
      title={`v${data.version} — ${data.model}`}
      subtitle={`Generated ${formatDateTime(data.generatedAt)} | ${data.enginePath}`}
    >
      {data.performanceSnapshot && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="P&L"
            value={formatCurrency(data.performanceSnapshot.profitLoss)}
            valueClassName={
              data.performanceSnapshot.profitLoss >= 0 ? "text-emerald-400" : "text-red-400"
            }
          />
          <StatCard title="Total Bets" value={String(data.performanceSnapshot.totalBets)} />
          <StatCard title="Accuracy" value={formatPct(data.performanceSnapshot.accuracy)} />
          <StatCard title="ROI" value={formatPct(data.performanceSnapshot.roi)} />
        </div>
      )}

      {data.overallAssessment && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-400">Overall Assessment</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-300 whitespace-pre-wrap">{data.overallAssessment}</p>
          </CardContent>
        </Card>
      )}

      {signals && Object.keys(signals).length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-400">Signal Weights</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">Signal</TableHead>
                  <TableHead className="text-zinc-400 text-right">Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(signals)
                  .sort(([, a], [, b]) => b - a)
                  .map(([name, weight]) => (
                    <TableRow key={name} className="border-zinc-800 hover:bg-zinc-800/50">
                      <TableCell className="font-mono text-zinc-300 text-sm">{name}</TableCell>
                      <TableCell className="text-right font-mono text-zinc-300 text-sm">
                        {weight.toFixed(3)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {Object.keys(globalParams).length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-400">Global Parameters</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">Parameter</TableHead>
                  <TableHead className="text-zinc-400 text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(globalParams).map(([name, value]) => (
                  <TableRow key={name} className="border-zinc-800 hover:bg-zinc-800/50">
                    <TableCell className="font-mono text-zinc-300 text-sm">{name}</TableCell>
                    <TableCell className="text-right font-mono text-zinc-300 text-sm">
                      {typeof value === "number" ? value.toFixed(3) : String(value)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data.changelog.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-400">Changelog</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">Parameter</TableHead>
                  <TableHead className="text-zinc-400 text-right">Previous</TableHead>
                  <TableHead className="text-zinc-400 text-right">New</TableHead>
                  <TableHead className="text-zinc-400">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.changelog.map((entry) => (
                  <TableRow key={entry.parameter} className="border-zinc-800 hover:bg-zinc-800/50">
                    <TableCell className="font-mono text-zinc-300 text-sm">
                      {entry.parameter}
                    </TableCell>
                    <TableCell className="text-right font-mono text-zinc-400 text-sm">
                      {entry.previous.toFixed(3)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-zinc-300 text-sm">
                      {entry.new.toFixed(3)}
                    </TableCell>
                    <TableCell className="text-zinc-400 text-sm max-w-md">{entry.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
