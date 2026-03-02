export function Money({ value }: { value: number | null }) {
  if (value == null) return <span className="text-zinc-500">--</span>;
  const sign = value >= 0 ? "+" : "";
  const color = value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : "text-zinc-400";
  return (
    <span className={`font-mono ${color}`}>
      {sign}${Math.abs(value).toFixed(2)}
    </span>
  );
}
