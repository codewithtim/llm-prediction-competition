import { Badge } from "@/components/ui/badge";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  scheduled: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  in_progress: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  finished: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  submitting: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  pending: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  filled: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  settled_won: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  settled_lost: "bg-red-500/15 text-red-400 border-red-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30",
  postponed: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  disabled: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
  closed: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30",
  inactive: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30",
  won: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  lost: "bg-red-500/15 text-red-400 border-red-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  settled_won: "Won",
  settled_lost: "Lost",
  in_progress: "In Progress",
};

export function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  const label = STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <Badge variant="outline" className={`${colors} text-xs font-medium`}>
      {label}
    </Badge>
  );
}
