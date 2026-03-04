import { describe, expect, it } from "bun:test";
import { classifyBetError, extractMinBetSize } from "../../../../src/domain/services/bet-errors";

describe("classifyBetError", () => {
  it('classifies "insufficient balance" as insufficient_funds', () => {
    expect(classifyBetError(new Error("insufficient balance"))).toBe("insufficient_funds");
  });

  it('classifies "not enough funds" as insufficient_funds', () => {
    expect(classifyBetError(new Error("not enough funds"))).toBe("insufficient_funds");
  });

  it('classifies "not enough balance / allowance" as insufficient_funds', () => {
    expect(classifyBetError(new Error("not enough balance / allowance"))).toBe("insufficient_funds");
  });

  it('classifies "timeout" as network_error', () => {
    expect(classifyBetError(new Error("request timeout"))).toBe("network_error");
  });

  it('classifies "ECONNREFUSED" as network_error', () => {
    expect(classifyBetError(new Error("connect ECONNREFUSED 127.0.0.1:443"))).toBe("network_error");
  });

  it('classifies "ECONNRESET" as network_error', () => {
    expect(classifyBetError(new Error("socket hang up ECONNRESET"))).toBe("network_error");
  });

  it('classifies "429" as rate_limited', () => {
    expect(classifyBetError(new Error("Request failed with status 429"))).toBe("rate_limited");
  });

  it('classifies "rate limit" as rate_limited', () => {
    expect(classifyBetError(new Error("rate limit exceeded"))).toBe("rate_limited");
  });

  it('classifies "invalid signature" as wallet_error', () => {
    expect(classifyBetError(new Error("invalid signature"))).toBe("wallet_error");
  });

  it('classifies "nonce too low" as wallet_error', () => {
    expect(classifyBetError(new Error("nonce too low"))).toBe("wallet_error");
  });

  it('classifies "market not found" as invalid_market', () => {
    expect(classifyBetError(new Error("market not found"))).toBe("invalid_market");
  });

  it('classifies "market closed" as invalid_market', () => {
    expect(classifyBetError(new Error("market closed for trading"))).toBe("invalid_market");
  });

  it('classifies "invalid amount...min size" as order_too_small', () => {
    expect(
      classifyBetError(
        new Error("invalid amount for a marketable BUY order ($0.3116), min size: $1"),
      ),
    ).toBe("order_too_small");
  });

  it("classifies unknown error string as unknown", () => {
    expect(classifyBetError(new Error("something completely unexpected"))).toBe("unknown");
  });

  it("handles non-Error values", () => {
    expect(classifyBetError("string error")).toBe("unknown");
    expect(classifyBetError(42)).toBe("unknown");
    expect(classifyBetError(null)).toBe("unknown");
  });
});

describe("extractMinBetSize", () => {
  it("extracts min size from Polymarket error", () => {
    expect(
      extractMinBetSize(
        new Error("invalid amount for a marketable BUY order ($0.3116), min size: $1"),
      ),
    ).toBe(1);
  });

  it("extracts decimal min size", () => {
    expect(extractMinBetSize("min size: $5.00")).toBe(5);
  });

  it("returns null for unrelated error message", () => {
    expect(extractMinBetSize(new Error("something completely unexpected"))).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(extractMinBetSize(null)).toBeNull();
    expect(extractMinBetSize(undefined)).toBeNull();
  });
});
