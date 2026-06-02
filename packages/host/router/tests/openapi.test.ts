import { describe, expect, it } from "vitest";
import { buildOpenApiDocument, patternToOpenApiPath, routeRequiresBearerAuth } from "../src/openapi.js";
import { Router } from "../src/koa-router.js";
import { createServer } from "node:http";

describe("openapi", () => {
  it("patternToOpenApiPath converts splat", () => {
    expect(patternToOpenApiPath("/pub/marketplace/detail/:name+")).toBe(
      "/pub/marketplace/detail/{name}",
    );
  });

  it("routeRequiresBearerAuth respects /pub", () => {
    expect(routeRequiresBearerAuth("/pub/health", "/api")).toBe(false);
    expect(routeRequiresBearerAuth("/api/stats", "/api")).toBe(true);
  });

  it("builds paths from Router.listRoutes", () => {
    const server = createServer();
    const router = new Router(server);
    router.get("/api/foo", (ctx) => {
      ctx.body = { ok: true };
    });
    const doc = buildOpenApiDocument(router.listRoutes(), { apiBase: "/api" });
    const paths = doc.paths as Record<string, unknown>;
    expect(paths["/api/foo"]).toBeDefined();
    server.close();
  });
});
