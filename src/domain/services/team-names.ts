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
  ["paris saint-germain", "paris saint germain", "paris sg", "psg"],
  ["bayern munich", "bayern münchen", "bayern munchen", "bayern"],
  ["real madrid", "real madrid cf"],
  ["fc barcelona", "barcelona", "barca"],
  ["atletico madrid", "atletico de madrid", "club atletico de madrid", "atletico"],
  ["rb leipzig", "rasenballsport leipzig", "leipzig"],
  ["bayer leverkusen", "bayer 04 leverkusen", "leverkusen"],
  ["juventus", "juventus fc"],
  ["galatasaray", "galatasaray sk"],
  ["sporting cp", "sporting lisbon", "sporting"],
  ["celtic", "celtic fc"],
  ["club brugge", "club bruges"],
  ["red bull salzburg", "fc salzburg", "salzburg"],
  ["shakhtar donetsk", "shakhtar"],
  ["atalanta", "atalanta bc"],
  ["bodø/glimt", "bodo/glimt", "bodo glimt", "fk bodø/glimt"],
];

const SUFFIX_PATTERN = /\b(fc|afc|sc|cf|sv|ssc|as|bsc|bc|vfb|vfl|rb|sk|fk)\b/gi;

export function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00f8/g, "o")
    .replace(/\u00d8/g, "O")
    .replace(SUFFIX_PATTERN, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const CANONICAL_NAMES = new Map<string, string>();
for (const group of TEAM_NAME_GROUPS) {
  const canonical = group[0] as string;
  for (const name of group) {
    CANONICAL_NAMES.set(normalizeTeamName(name), canonical);
  }
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
