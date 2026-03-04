export const ERROR_CATEGORIES: Record<string, { label: string; className: string }> = {
  insufficient_funds: {
    label: "Insufficient Funds",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  network_error: {
    label: "Network Error",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  rate_limited: {
    label: "Rate Limited",
    className: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  },
  wallet_error: {
    label: "Wallet Error",
    className: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  },
  invalid_market: {
    label: "Invalid Market",
    className: "bg-pink-500/15 text-pink-400 border-pink-500/30",
  },
  unknown: {
    label: "Unknown Error",
    className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  },
};
