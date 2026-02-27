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
  test("applies alias for known team", () => {
    expect(resolveTeamName("Tottenham Hotspur FC")).toBe("tottenham");
  });

  test("falls through for unknown team", () => {
    expect(resolveTeamName("Brentford FC")).toBe("brentford");
  });

  test("applies alias for Inter Milan", () => {
    expect(resolveTeamName("Inter Milan")).toBe("inter");
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
});
