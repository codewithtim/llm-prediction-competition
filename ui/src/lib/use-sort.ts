import { useMemo, useRef, useState } from "react";

export type SortDirection = "asc" | "desc";
export type SortState<K extends string> = { key: K; direction: SortDirection };

export function useSort<T, K extends string>(
  data: T[] | undefined,
  defaultSort: SortState<K>,
  getters: Record<K, (item: T) => number | string | null>,
) {
  const [sort, setSort] = useState<SortState<K>>(defaultSort);
  const gettersRef = useRef(getters);
  gettersRef.current = getters;

  const toggle = (key: K) => {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "desc" },
    );
  };

  const sorted = useMemo(() => {
    if (!data) return undefined;
    const getter = gettersRef.current[sort.key];
    return [...data].sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [data, sort.key, sort.direction]);

  return { sorted, sort, toggle };
}
