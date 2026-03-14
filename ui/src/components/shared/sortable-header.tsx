import { TableHead } from "@/components/ui/table";
import type { SortDirection } from "@/lib/use-sort";

export function SortableHeader({
  label,
  sortKey,
  currentKey,
  direction,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: string;
  currentKey: string;
  direction: SortDirection;
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = sortKey === currentKey;
  const arrow = active ? (direction === "asc" ? " ▲" : " ▼") : "";

  return (
    <TableHead
      className={`text-zinc-400 cursor-pointer select-none hover:text-zinc-200 ${className}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {arrow && <span className="text-zinc-500 text-xs ml-0.5">{arrow}</span>}
    </TableHead>
  );
}
