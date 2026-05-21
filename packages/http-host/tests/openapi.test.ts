import { describe, expect, it } from "vitest";
import { RouteTable, buildOpenApiDocument, patternToOpenApiPath, routeRequiresBearerAuth } from "../src/index.js";

describe("patternToOpenApiPath", () => {
  it("converts path params", () => {
    expect(patternToOpenApiPath("/api/plugins/:name")).toBe("/api/plugins/{name}");
  });
});

describe("routeRequiresBearerAuth", () => {
  it("excludes pub paths", () => {
    expect(routeRequiresBearerAuth("/pub/health", "/api")).toBe(false);
    expect(routeRequiresBearerAuth("/api/system/status", "/api")).toBe(true);
  });
});

describe("buildOpenApiDocument", () => {
  it("builds paths from RouteTable snapshot", () => {
    const table = new RouteTable();
    table.get("/pub/health", async () => {});
    table.get("/api/hello", async () => {});

    const doc = buildOpenApiDocument(table.listRoutes(), {
      apiBase: "/api",
      serverUrl: "http://localhost:8086",
      title: "Test",
      version: "1.0.0",
    });

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "http://localhost:8086" }]);
    const paths = doc.paths as Record<string, Record<string, { security?: unknown[] }>>;
    expect(paths["/pub/health"]?.get?.security).toBeUndefined();
    expect(paths["/api/hello"]?.get?.security).toEqual([{ bearerAuth: [] }]);
  });
});
