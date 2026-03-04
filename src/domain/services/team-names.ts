export const TEAM_NAME_GROUPS: string[][] = [
  ["tottenham hotspur", "tottenham", "spurs"],
  ["wolverhampton wanderers", "wolverhampton", "wolves"],
  ["west ham united", "west ham"],
  ["newcastle united", "newcastle"],
  ["sheffield united", "sheffield utd"],
  ["nottingham forest", "nottm forest"],
  ["athletic bilbao", "athletic club"],
  ["inter milan", "inter", "internazionale"],
  ["ac milan", "milan"],
  ["borussia dortmund", "dortmund", "bvb"],
];

const CANONICAL_NAMES = new Map<string, string>();
for (const group of TEAM_NAME_GROUPS) {
  const canonical = group[0] as string;
  for (const name of group) {
    CANONICAL_NAMES.set(name, canonical);
  }
}

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
  return CANONICAL_NAMES.get(normalized) ?? normalized;
}

export function teamNamesMatch(polymarketName: string, apiFootballName: string): boolean {
  const resolved = resolveTeamName(polymarketName);
  const normalized = resolveTeamName(apiFootballName);

  if (resolved === normalized) return true;

  return resolved.includes(normalized) || normalized.includes(resolved);
}
