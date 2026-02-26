const server = Bun.serve({
  port: process.env.PORT ?? 3000,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.log(`Server running on http://localhost:${server.port}`);
