export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <p className="text-zinc-500 text-sm">{message}</p>
    </div>
  );
}
