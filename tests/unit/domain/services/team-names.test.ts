import { describe, expect, test } from "bun:test";
import {
  normalizeTeamName,
  resolveTeamName,
  teamNamesMatch,
} from "../../../../src/domain/services/team-names.ts";

describe("normalizeTeamName", () => {
  test("strips FC suffix", () => {
    expect(normalizeTeamName("Arsenal FC")).toBe("arsenal");
  });

  test("strips AFC suffix", () => {
    expect(normalizeTeamName("AFC Bournemouth")).toBe("bournemouth");
  });

  test("strips SC suffix", () => {
    expect(normalizeTeamName("Freiburg SC")).toBe("freiburg");
  });

  test("removes punctuation", () => {
    expect(normalizeTeamName("St. Pauli")).toBe("st pauli");
  });

  test("collapses whitespace and lowercases", () => {
    expect(normalizeTeamName("  Manchester   United  ")).toBe("manchester united");
  });

  test("preserves United", () => {
    expect(normalizeTeamName("Manchester United")).toBe("manchester united");
  });

  test("preserves City", () => {
    expect(normalizeTeamName("Leicester City")).toBe("leicester city");
  });
});

describe("resolveTeamName", () => {
  test("resolves to canonical name for known team", () => {
    expect(resolveTeamName("Tottenham Hotspur FC")).toBe("tottenham hotspur");
    expect(resolveTeamName("Tottenham")).toBe("tottenham hotspur");
    expect(resolveTeamName("Spurs")).toBe("tottenham hotspur");
  });

  test("falls through for unknown team", () => {
    expect(resolveTeamName("Brentford FC")).toBe("brentford");
  });

  test("resolves all variations of same team to same canonical", () => {
    expect(resolveTeamName("Inter Milan")).toBe("inter milan");
    expect(resolveTeamName("Inter")).toBe("inter milan");
    expect(resolveTeamName("Internazionale")).toBe("inter milan");
  });

  test("resolves Wolves variations to same canonical", () => {
    expect(resolveTeamName("Wolverhampton Wanderers FC")).toBe("wolverhampton wanderers");
    expect(resolveTeamName("Wolverhampton")).toBe("wolverhampton wanderers");
    expect(resolveTeamName("Wolves")).toBe("wolverhampton wanderers");
  });
});

describe("teamNamesMatch", () => {
  test("exact match after normalization", () => {
    expect(teamNamesMatch("Arsenal FC", "Arsenal")).toBe(true);
  });

  test("match via alias", () => {
    expect(teamNamesMatch("Tottenham Hotspur FC", "Tottenham")).toBe(true);
  });

  test("match via substring containment", () => {
    expect(teamNamesMatch("Crystal Palace FC", "Crystal Palace")).toBe(true);
  });

  test("rejects different teams", () => {
    expect(teamNamesMatch("Arsenal FC", "Chelsea")).toBe(false);
  });

  test("rejects partial collisions between Manchester United and Manchester City", () => {
    expect(teamNamesMatch("Manchester United FC", "Manchester City")).toBe(false);
  });

  test("rejects partial collisions between Manchester City and Manchester United", () => {
    expect(teamNamesMatch("Manchester City FC", "Manchester United")).toBe(false);
  });

  test("matches Nottingham Forest via symmetric alias resolution", () => {
    expect(teamNamesMatch("Nottingham Forest FC", "Nottingham Forest")).toBe(true);
  });

  test("matches Sheffield United via symmetric alias resolution", () => {
    expect(teamNamesMatch("Sheffield United FC", "Sheffield United")).toBe(true);
  });

  test("matches Athletic Bilbao to Athletic Club and vice versa", () => {
    expect(teamNamesMatch("Athletic Bilbao", "Athletic Club")).toBe(true);
    expect(teamNamesMatch("Athletic Club", "Athletic Bilbao")).toBe(true);
  });

  test("matches Manchester City FC from Polymarket to Manchester City from API-Football", () => {
    expect(teamNamesMatch("Manchester City FC", "Manchester City")).toBe(true);
  });

  test("matches Fulham FC from Polymarket to Fulham from API-Football", () => {
    expect(teamNamesMatch("Fulham FC", "Fulham")).toBe(true);
  });

  test("matches Brentford FC from Polymarket to Brentford from API-Football", () => {
    expect(teamNamesMatch("Brentford FC", "Brentford")).toBe(true);
  });

  test("matches Wolverhampton Wanderers FC from Polymarket to Wolverhampton from API-Football", () => {
    expect(teamNamesMatch("Wolverhampton Wanderers FC", "Wolverhampton")).toBe(true);
  });

  test("matches Wolverhampton Wanderers FC from Polymarket to Wolves from API-Football", () => {
    expect(teamNamesMatch("Wolverhampton Wanderers FC", "Wolves")).toBe(true);
  });

  test("matches Wolves to Wolverhampton", () => {
    expect(teamNamesMatch("Wolves", "Wolverhampton")).toBe(true);
  });

  test("matches Spurs to Tottenham Hotspur", () => {
    expect(teamNamesMatch("Spurs", "Tottenham Hotspur")).toBe(true);
  });
});

describe("Champions League team name matching", () => {
  test("matches Club Atlético de Madrid from Polymarket to Atletico Madrid from API-Football", () => {
    expect(teamNamesMatch("Club Atlético de Madrid", "Atletico Madrid")).toBe(true);
  });

  test("matches Paris Saint-Germain FC from Polymarket to Paris Saint Germain from API-Football", () => {
    expect(teamNamesMatch("Paris Saint-Germain FC", "Paris Saint Germain")).toBe(true);
  });

  test("matches Chelsea FC from Polymarket to Chelsea from API-Football", () => {
    expect(teamNamesMatch("Chelsea FC", "Chelsea")).toBe(true);
  });

  test("matches Galatasaray SK from Polymarket to Galatasaray from API-Football", () => {
    expect(teamNamesMatch("Galatasaray SK", "Galatasaray")).toBe(true);
  });

  test("matches Liverpool FC from Polymarket to Liverpool from API-Football", () => {
    expect(teamNamesMatch("Liverpool FC", "Liverpool")).toBe(true);
  });

  test("matches Newcastle United FC from Polymarket to Newcastle United from API-Football", () => {
    expect(teamNamesMatch("Newcastle United FC", "Newcastle United")).toBe(true);
  });

  test("matches FC Barcelona from Polymarket to Barcelona from API-Football", () => {
    expect(teamNamesMatch("FC Barcelona", "Barcelona")).toBe(true);
  });

  test("matches FK Bodø/Glimt from Polymarket to Bodo/Glimt from API-Football", () => {
    expect(teamNamesMatch("FK Bodø/Glimt", "Bodo/Glimt")).toBe(true);
  });

  test("matches Sporting CP from Polymarket to Sporting CP from API-Football", () => {
    expect(teamNamesMatch("Sporting CP", "Sporting CP")).toBe(true);
  });

  test("matches Real Madrid CF from Polymarket to Real Madrid from API-Football", () => {
    expect(teamNamesMatch("Real Madrid CF", "Real Madrid")).toBe(true);
  });

  test("matches Atalanta BC from Polymarket to Atalanta from API-Football", () => {
    expect(teamNamesMatch("Atalanta BC", "Atalanta")).toBe(true);
  });

  test("matches FC Bayern München from Polymarket to Bayern Munich from API-Football", () => {
    expect(teamNamesMatch("FC Bayern München", "Bayern Munich")).toBe(true);
  });

  test("matches Bayer 04 Leverkusen from Polymarket to Bayer Leverkusen from API-Football", () => {
    expect(teamNamesMatch("Bayer 04 Leverkusen", "Bayer Leverkusen")).toBe(true);
  });
});
