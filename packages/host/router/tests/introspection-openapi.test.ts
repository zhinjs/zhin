import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../src/openapi.js";
import { Router } from "../src/koa-router.js";
import { introspectionRouteMeta } from "../src/introspection-openapi.js";
import { createServer } from "node:http";

describe("introspection OpenAPI", () => {
  it("GET /api/introspection/tools 含 query 参数与响应 schema", () => {
    const server = createServer();
    const router = new Router(server, "/api");
    router.get(
      "/introspection/tools",
      introspectionRouteMeta("tools"),
      (ctx) => {
        ctx.body = { success: true, data: { items: [], page: 1, pageSize: 15, total: 0, totalPages: 0 } };
      },
    );

    const doc = buildOpenApiDocument(router.listRoutes(), { apiBase: "/api" });
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
    const op = paths["/api/introspection/tools"]?.get as Record<string, unknown>;
    expect(op?.operationId).toBe("getIntrospectionTools");
    expect(op?.tags).toContain("introspection");

    const params = op?.parameters as Array<{ name: string; in: string }>;
    expect(params?.map((p) => `${p.in}:${p.name}`)).toEqual(
      expect.arrayContaining(["query:page", "query:pageSize", "query:filter"]),
    );

    const responses = op?.responses as Record<string, { content?: Record<string, unknown> }>;
    const schema = responses?.["200"]?.content?.["application/json"] as { schema?: Record<string, unknown> };
    expect(JSON.stringify(schema?.schema)).toContain("IntrospectionToolItem");

    const components = doc.components as { schemas?: Record<string, unknown> };
    expect(components.schemas?.IntrospectionToolItem).toBeDefined();
    expect(components.schemas?.IntrospectionPageData).toBeDefined();

    server.close();
  });
});
