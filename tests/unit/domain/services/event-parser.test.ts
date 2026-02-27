import { describe, expect, test } from "bun:test";
import {
  extractUTCDate,
  parseEventTitle,
  sameDateUTC,
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

describe("sameDateUTC", () => {
  test("returns true for same UTC day", () => {
    expect(sameDateUTC("2026-03-05T15:00:00Z", "2026-03-05T20:00:00Z")).toBe(true);
  });

  test("returns false for different UTC days", () => {
    expect(sameDateUTC("2026-03-05T20:00:00Z", "2026-03-06T20:00:00Z")).toBe(false);
  });

  test("handles offset strings resolving to same UTC day", () => {
    expect(sameDateUTC("2026-03-05T20:00:00Z", "2026-03-05T21:00:00+01:00")).toBe(true);
  });
});
