export const TEAM_ALIASES: Record<string, string> = {
  "tottenham hotspur": "tottenham",
  "wolverhampton wanderers": "wolverhampton",
  "west ham united": "west ham",
  "newcastle united": "newcastle",
  "sheffield united": "sheffield utd",
  "nottingham forest": "nottm forest",
  "athletic bilbao": "athletic club",
  "inter milan": "inter",
  "ac milan": "milan",
  "borussia dortmund": "dortmund",
};

const SUFFIX_PATTERN = /\b(fc|afc|sc|cf|sv|ssc|as|bsc|vfb|vfl|rb)\b/gi;

export function normalizeTeamName(name: string): string {
  return name
    .replace(SUFFIX_PATTERN, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function resolveTeamName(name: string): string {
  const normalized = normalizeTeamName(name);
  return TEAM_ALIASES[normalized] ?? normalized;
}

export function teamNamesMatch(polymarketName: string, apiFootballName: string): boolean {
  const resolved = resolveTeamName(polymarketName);
  const normalized = normalizeTeamName(apiFootballName);

  if (resolved === normalized) return true;

  return resolved.includes(normalized) || normalized.includes(resolved);
}
