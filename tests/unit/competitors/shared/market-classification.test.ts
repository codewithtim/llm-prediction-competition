import { describe, expect, it } from "bun:test";
import { classifyMarket } from "../../../../src/competitors/shared/market-classification";

describe("classifyMarket", () => {
  it("classifies home team market", () => {
    expect(classifyMarket("Will Arsenal win vs Chelsea?", "Arsenal", "Chelsea")).toBe("home");
  });

  it("classifies away team market", () => {
    expect(classifyMarket("Will Chelsea win vs Arsenal?", "Arsenal", "Chelsea")).toBe("away");
  });

  it("classifies draw market", () => {
    expect(classifyMarket("Will Arsenal vs Chelsea end in a draw?", "Arsenal", "Chelsea")).toBe(
      "draw",
    );
  });

  it("is case insensitive", () => {
    expect(classifyMarket("will arsenal win?", "Arsenal", "Chelsea")).toBe("home");
  });

  it("defaults to home when ambiguous", () => {
    expect(classifyMarket("Who will triumph?", "Arsenal", "Chelsea")).toBe("home");
  });

  it("classifies by team name without 'win'", () => {
    expect(classifyMarket("Arsenal to score first", "Arsenal", "Chelsea")).toBe("home");
    expect(classifyMarket("Chelsea to score first", "Arsenal", "Chelsea")).toBe("away");
  });
});
