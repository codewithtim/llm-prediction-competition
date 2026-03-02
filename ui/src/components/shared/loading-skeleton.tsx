import { Skeleton } from "@/components/ui/skeleton";

export function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-24 bg-zinc-800" />
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
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-12 bg-zinc-800" />
      ))}
    </div>
  );
}
