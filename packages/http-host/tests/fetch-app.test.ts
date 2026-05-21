import { describe, it, expect } from "vitest";
import { RouteTable, createFetchApp } from "../src/index.js";

describe("createFetchApp", () => {
  it("routes GET and returns JSON body", async () => {
    const routes = new RouteTable();
    routes.get("/api/hello", async (ctx) => {
      ctx.body = { ok: true };
    });
    const app = createFetchApp(routes, { base: "/api", token: "secret" });
    const res = await app.fetch(
      new Request("http://localhost/api/hello", {
        headers: { Authorization: "Bearer secret" },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects missing token on api paths", async () => {
    const routes = new RouteTable();
    routes.get("/api/x", async (ctx) => {
      ctx.body = {};
    });
    const app = createFetchApp(routes, { base: "/api", token: "t" });
    const res = await app.fetch(new Request("http://localhost/api/x"));
    expect(res.status).toBe(401);
  });

  it("allows /pub without token", async () => {
    const routes = new RouteTable();
    routes.get("/pub/health", async (ctx) => {
      ctx.body = { status: "ok" };
    });
    const app = createFetchApp(routes, { base: "/api", token: "t" });
    const res = await app.fetch(new Request("http://localhost/pub/health"));
    expect(res.status).toBe(200);
  });

  it("handles CORS preflight", async () => {
    const routes = new RouteTable();
    const app = createFetchApp(routes, {
      base: "/api",
      corsOrigins: ["https://console.example"],
    });
    const res = await app.fetch(
      new Request("http://localhost/api/x", {
        method: "OPTIONS",
        headers: { Origin: "https://console.example" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://console.example");
  });
});
