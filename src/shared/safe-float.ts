/** Coerce a number to a finite float, returning `fallback` for NaN/Infinity. */
export function safeFloat(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}
