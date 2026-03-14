export function classifyMarket(
  question: string,
  homeTeamName: string,
  awayTeamName: string,
): "home" | "away" | "draw" {
  const q = question.toLowerCase();
  const home = homeTeamName.toLowerCase();
  const away = awayTeamName.toLowerCase();

  if (q.includes("draw")) return "draw";

  const homeWinPattern = `${home} win`;
  const awayWinPattern = `${away} win`;

  if (q.includes(homeWinPattern) && q.includes(awayWinPattern)) {
    return q.indexOf(homeWinPattern) < q.indexOf(awayWinPattern) ? "home" : "away";
  }
  if (q.includes(homeWinPattern)) return "home";
  if (q.includes(awayWinPattern)) return "away";

  const homeIdx = q.indexOf(home);
  const awayIdx = q.indexOf(away);
  if (homeIdx !== -1 && awayIdx !== -1) {
    return homeIdx < awayIdx ? "home" : "away";
  }
  if (homeIdx !== -1) return "home";
  if (awayIdx !== -1) return "away";
  return "home";
}
