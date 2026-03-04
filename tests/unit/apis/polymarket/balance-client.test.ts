import { afterEach, describe, expect, mock, test } from "bun:test";
import { getUsdcBalance } from "../../../../src/apis/polymarket/balance-client.ts";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

function mockFetch(response: { ok: boolean; body: unknown }) {
  fetchMock = mock(() =>
    Promise.resolve({
      ok: response.ok,
      status: response.ok ? 200 : 500,
      json: () => Promise.resolve(response.body),
    } as Response),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getUsdcBalance", () => {
  test("parses hex balance and converts to USD (6 decimals)", async () => {
    // 10 USDC = 10_000_000 = 0x989680
    mockFetch({
      ok: true,
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: "0x0000000000000000000000000000000000000000000000000000000000989680",
      },
    });

    const balance = await getUsdcBalance("0x1234567890abcdef1234567890abcdef12345678");
    expect(balance).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const callArgs = fetchMock.mock.calls[0] as unknown[];
    expect(callArgs[0]).toBe("https://polygon-bor-rpc.publicnode.com");
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(body.method).toBe("eth_call");
    expect(body.params[0].data).toContain("70a08231"); // balanceOf selector
  });

  test("returns 0 for zero balance", async () => {
    mockFetch({
      ok: true,
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    });

    const balance = await getUsdcBalance("0xabc");
    expect(balance).toBe(0);
  });

  test("handles fractional USDC (e.g. 5.50)", async () => {
    // 5.50 USDC = 5_500_000 = 0x53EC60
    mockFetch({
      ok: true,
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: "0x00000000000000000000000000000000000000000000000000000000053EC60",
      },
    });

    const balance = await getUsdcBalance("0xabc");
    expect(balance).toBeCloseTo(5.5, 2);
  });

  test("returns null when all RPCs return errors", async () => {
    mockFetch({
      ok: true,
      body: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "execution reverted" },
      },
    });

    const balance = await getUsdcBalance("0xabc");
    expect(balance).toBeNull();
    // Should have tried both RPCs
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("returns null when all RPCs throw (network error)", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("network down"))) as any;

    const balance = await getUsdcBalance("0xabc");
    expect(balance).toBeNull();
  });

  test("falls back to second RPC when first fails", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("first rpc down"));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            jsonrpc: "2.0",
            id: 1,
            result: "0x0000000000000000000000000000000000000000000000000000000000989680",
          }),
      } as Response);
    }) as any;

    const balance = await getUsdcBalance("0xabc");
    expect(balance).toBe(10);
    expect(callCount).toBe(2);
  });

  test("encodes wallet address in call data correctly", async () => {
    mockFetch({
      ok: true,
      body: { jsonrpc: "2.0", id: 1, result: "0x00" },
    });

    await getUsdcBalance("0x00000000000000000000000000000000DeaDBeef");

    const callArgs = fetchMock.mock.calls[0] as unknown[];
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    // address should be lowercase, zero-padded to 64 hex chars, after the 4-byte selector
    const data: string = body.params[0].data;
    expect(data.startsWith("0x70a08231")).toBe(true);
    expect(data).toContain("deadbeef");
    // Total length: 0x + 8 (selector) + 64 (address) = 74
    expect(data.length).toBe(74);
  });
});
