import { afterAll, describe, expect, it } from "bun:test";

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

afterAll(() => {
  server.stop();
});

describe("health check", () => {
  it("returns ok", async () => {
    const res = await fetch(`http://localhost:${server.port}/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`http://localhost:${server.port}/unknown`);
    expect(res.status).toBe(404);
  });
});
