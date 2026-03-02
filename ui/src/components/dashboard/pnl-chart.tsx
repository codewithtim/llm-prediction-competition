import type { LeaderboardEntry } from "@shared/api-types";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PnlChart({ entries }: { entries: LeaderboardEntry[] }) {
  const data = entries.map((e) => ({
    name: e.competitor.name,
    pnl: e.competitor.stats.profitLoss,
  }));

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-zinc-400">P&L by Competitor</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-8">No data yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data}>
              <XAxis dataKey="name" stroke="#71717a" fontSize={12} tickLine={false} />
              <YAxis
                stroke="#71717a"
                fontSize={12}
                tickLine={false}
                tickFormatter={(v: number) => `$${v}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#18181b",
                  border: "1px solid #27272a",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                formatter={(value) => [`$${Number(value).toFixed(2)}`, "P&L"]}
              />
              <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell key={index} fill={entry.pnl >= 0 ? "#10b981" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
