import { describe, expect, test } from "bun:test";
import {
  datesMatchForFixture,
  extractUTCDate,
  parseEventTitle,
} from "../../../../src/domain/services/event-parser.ts";

describe("parseEventTitle", () => {
  test("parses standard title with vs. separator", () => {
    const result = parseEventTitle("Tottenham Hotspur FC vs. Crystal Palace FC");
    expect(result).toEqual({
      homeTeam: "Tottenham Hotspur FC",
      awayTeam: "Crystal Palace FC",
    });
  });

  test("parses title with vs (no dot) separator", () => {
    const result = parseEventTitle("Arsenal FC vs Chelsea FC");
    expect(result).toEqual({
      homeTeam: "Arsenal FC",
      awayTeam: "Chelsea FC",
    });
  });

  test("strips - More Markets suffix", () => {
    const result = parseEventTitle("Arsenal FC vs. Brighton FC - More Markets");
    expect(result).toEqual({
      homeTeam: "Arsenal FC",
      awayTeam: "Brighton FC",
    });
  });

  test("returns null for unparseable title", () => {
    expect(parseEventTitle("Will Arsenal win the league?")).toBeNull();
  });

  test("returns null for title with no teams", () => {
    expect(parseEventTitle("vs.")).toBeNull();
  });

  test("handles extra whitespace", () => {
    const result = parseEventTitle("  Arsenal FC   vs.   Chelsea FC  ");
    expect(result).toEqual({
      homeTeam: "Arsenal FC",
      awayTeam: "Chelsea FC",
    });
  });
});

describe("extractUTCDate", () => {
  test("extracts date from UTC ISO string", () => {
    expect(extractUTCDate("2026-03-05T20:00:00Z")).toBe("2026-03-05");
  });

  test("extracts date from offset ISO string", () => {
    expect(extractUTCDate("2026-03-05T23:30:00+01:00")).toBe("2026-03-05");
  });

  test("handles timezone conversion across date boundary", () => {
    // 2026-03-06T00:30:00+01:00 = 2026-03-05T23:30:00Z
    expect(extractUTCDate("2026-03-06T00:30:00+01:00")).toBe("2026-03-05");
  });
});

describe("datesMatchForFixture", () => {
  test("returns true for same timestamp", () => {
    expect(datesMatchForFixture("2026-03-05T20:00:00Z", "2026-03-05T20:00:00Z")).toBe(true);
  });

  test("returns true for dates within 24 hours", () => {
    expect(datesMatchForFixture("2026-03-05T20:00:00Z", "2026-03-06T15:00:00Z")).toBe(true);
  });

  test("real-world: Wolves vs Liverpool 19h apart matches", () => {
    expect(datesMatchForFixture("2026-03-06T20:00:00+00:00", "2026-03-07T15:00:00Z")).toBe(true);
  });

  test("returns false for dates more than 24 hours apart", () => {
    expect(datesMatchForFixture("2026-03-05T10:00:00Z", "2026-03-06T11:00:00Z")).toBe(false);
  });

  test("returns false for dates 25 hours apart", () => {
    expect(datesMatchForFixture("2026-03-05T10:00:00Z", "2026-03-06T11:00:00Z")).toBe(false);
  });
});
