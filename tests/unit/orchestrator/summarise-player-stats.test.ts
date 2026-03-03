import { describe, expect, it } from "bun:test";
import type { Injury, PlayerSeasonStats } from "../../../src/domain/contracts/statistics.ts";
import { summarisePlayerStats } from "../../../src/orchestrator/prediction-pipeline.ts";

function makePlayer(overrides: Partial<PlayerSeasonStats> = {}): PlayerSeasonStats {
  return {
    playerId: 1,
    name: "Player 1",
    position: "Forward",
    rating: 7.0,
    appearances: 10,
    minutes: 800,
    goals: 5,
    assists: 3,
    shotsTotal: 20,
    shotsOnTarget: 10,
    passesKey: 5,
    passAccuracy: 80,
    dribblesSuccess: 3,
    dribblesAttempts: 5,
    yellowCards: 2,
    redCards: 0,
    injured: false,
    ...overrides,
  };
}

describe("summarisePlayerStats", () => {
  it("returns empty array for empty player list", () => {
    const result = summarisePlayerStats([], []);
    expect(result).toEqual([]);
  });

  it("returns top 8 players sorted by rating", () => {
    const players = Array.from({ length: 12 }, (_, i) =>
      makePlayer({ playerId: i + 1, name: `Player ${i + 1}`, rating: 6.0 + i * 0.1 }),
    );
    const result = summarisePlayerStats(players, []);
    expect(result).toHaveLength(8);
    expect(result[0]!.playerId).toBe(12);
    expect(result[7]!.playerId).toBe(5);
  });

  it("appends injured player outside top 8", () => {
    const players = Array.from({ length: 10 }, (_, i) =>
      makePlayer({ playerId: i + 1, name: `Player ${i + 1}`, rating: 7.0 - i * 0.1 }),
    );
    const injuries: Injury[] = [
      { playerId: 10, playerName: "Player 10", type: "Missing Fixture", reason: "Knee", teamId: 1 },
    ];
    const result = summarisePlayerStats(players, injuries);
    expect(result).toHaveLength(9);
    expect(result.some((p) => p.playerId === 10)).toBe(true);
  });

  it("does not duplicate injured player already in top 8", () => {
    const players = Array.from({ length: 10 }, (_, i) =>
      makePlayer({ playerId: i + 1, name: `Player ${i + 1}`, rating: 7.0 - i * 0.1 }),
    );
    const injuries: Injury[] = [
      { playerId: 1, playerName: "Player 1", type: "Missing Fixture", reason: "Knee", teamId: 1 },
    ];
    const result = summarisePlayerStats(players, injuries);
    expect(result).toHaveLength(8);
    expect(result.filter((p) => p.playerId === 1)).toHaveLength(1);
  });

  it("works correctly with empty injuries list", () => {
    const players = Array.from({ length: 5 }, (_, i) =>
      makePlayer({ playerId: i + 1, name: `Player ${i + 1}`, rating: 7.0 - i * 0.1 }),
    );
    const result = summarisePlayerStats(players, []);
    expect(result).toHaveLength(5);
  });

  it("treats null rating as 0 for sorting", () => {
    const players = [
      makePlayer({ playerId: 1, rating: null }),
      makePlayer({ playerId: 2, rating: 6.5 }),
      makePlayer({ playerId: 3, rating: 7.0 }),
    ];
    const result = summarisePlayerStats(players, []);
    expect(result[0]!.playerId).toBe(3);
    expect(result[1]!.playerId).toBe(2);
    expect(result[2]!.playerId).toBe(1);
  });
});
