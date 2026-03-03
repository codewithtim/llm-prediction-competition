import { Skeleton } from "@/components/ui/skeleton";

const CARD_KEYS = ["a", "b", "c", "d"];
const ROW_KEYS = ["r1", "r2", "r3", "r4", "r5"];

export function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {CARD_KEYS.map((k) => (
          <Skeleton key={k} className="h-24 bg-zinc-800" />
        ))}
      </div>
      <Skeleton className="h-64 bg-zinc-800" />
      <Skeleton className="h-96 bg-zinc-800" />
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 bg-zinc-800" />
      {ROW_KEYS.map((k) => (
        <Skeleton key={k} className="h-12 bg-zinc-800" />
      ))}
    </div>
  );
}
