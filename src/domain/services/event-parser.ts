export type ParsedEventTitle = {
  homeTeam: string;
  awayTeam: string;
};

const MORE_MARKETS_SUFFIX = /\s*-\s*More Markets$/i;
const VS_SEPARATOR = /\s+vs\.?\s+/;

export function parseEventTitle(title: string): ParsedEventTitle | null {
  const cleaned = title.replace(MORE_MARKETS_SUFFIX, "");
  const parts = cleaned.split(VS_SEPARATOR);

  if (parts.length !== 2) return null;

  const homeTeam = parts[0]?.trim();
  const awayTeam = parts[1]?.trim();

  if (!homeTeam || !awayTeam) return null;

  return { homeTeam, awayTeam };
}

export function extractUTCDate(isoString: string): string {
  const date = new Date(isoString);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function datesMatchForFixture(dateA: string, dateB: string): boolean {
  const a = new Date(dateA);
  const b = new Date(dateB);
  const diffMs = Math.abs(a.getTime() - b.getTime());
  return diffMs <= 24 * 60 * 60 * 1000;
}
