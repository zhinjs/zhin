import type { RouteMeta } from "./route-meta.js";

export type ListedRoute = {
  method: string;
  pattern: string;
  meta?: RouteMeta;
};

export type BuildOpenApiOptions = {
  title?: string;
  version?: string;
  /** API path prefix, e.g. `/api` */
  apiBase?: string;
  /** e.g. `http://127.0.0.1:8086` */
  serverUrl?: string;
};

export function patternToOpenApiPath(pattern: string): string {
  return pattern.replace(/:([A-Za-z0-9_]+)\+/g, "{$1}").replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** Mirrors createFetchApp auth: `/pub/*` and non-`apiBase` paths are public unless whitelisted. */
export function routeRequiresBearerAuth(pathname: string, apiBase: string): boolean {
  if (pathname.startsWith("/pub/") || pathname === "/pub") return false;
  if (pathname.includes("/webhook")) return false;
  if (!pathname.startsWith(apiBase + "/") && pathname !== apiBase) return false;
  return true;
}

function defaultOperationId(method: string, pattern: string): string {
  const slug = pattern
    .replace(/^\//, "")
    .replace(/[{}]/g, "")
    .replace(/[/:]/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `${method.toLowerCase()}_${slug || "root"}`;
}

function inferTag(pattern: string, apiBase: string): string | undefined {
  const rest = pattern.startsWith(apiBase + "/")
    ? pattern.slice(apiBase.length + 1)
    : pattern.replace(/^\//, "");
  const seg = rest.split("/")[0];
  if (!seg || seg === "pub") return undefined;
  if (seg === "console") return "console";
  return seg;
}

function buildOperation(
  route: ListedRoute,
  apiBase: string,
): Record<string, unknown> {
  const { method, pattern, meta } = route;
  const op: Record<string, unknown> = {
    operationId: meta?.operationId ?? defaultOperationId(method, pattern),
    summary: meta?.summary ?? `${method} ${pattern}`,
    responses: {
      "200": {
        description: "Success",
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true },
          },
        },
      },
    },
  };
  if (meta?.description) op.description = meta.description;
  if (meta?.deprecated) op.deprecated = true;

  const tags = meta?.tags?.length ? meta.tags : [inferTag(pattern, apiBase)].filter(Boolean);
  if (tags.length) op.tags = tags;

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    op.requestBody = {
      content: {
        "application/json": {
          schema: { type: "object", additionalProperties: true },
        },
      },
    };
  }

  const params = [...pattern.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
    name: m[1],
    in: "path" as const,
    required: true,
    schema: { type: "string" },
  }));
  if (params.length) op.parameters = params;

  if (pattern.endsWith("/events") && method === "GET") {
    op.summary = meta?.summary ?? "Server-Sent Events stream";
    op.description =
      meta?.description ??
      "Console push channel (`text/event-stream`). Events: `{ type, data?, timestamp? }`.";
    op.responses = {
      "200": {
        description: "SSE stream",
        content: {
          "text/event-stream": {
            schema: { type: "string" },
          },
        },
      },
    };
  }

  if (pattern.includes("/console/request") && method === "POST") {
    op.summary = meta?.summary ?? "Console RPC";
    op.description =
      meta?.description ??
      "Remote Console request envelope: `{ type, data?, requestId? }` (same as legacy WebSocket `type`).";
    op.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["type"],
            properties: {
              type: { type: "string" },
              data: { type: "object", additionalProperties: true },
              requestId: { oneOf: [{ type: "number" }, { type: "string" }] },
            },
            additionalProperties: true,
          },
        },
      },
    };
  }

  if (routeRequiresBearerAuth(pattern, apiBase)) {
    op.security = [{ bearerAuth: [] }];
  }

  return op;
}

export function buildOpenApiDocument(
  routes: ListedRoute[],
  options: BuildOpenApiOptions = {},
): Record<string, unknown> {
  const apiBase = options.apiBase ?? "/api";
  const title = options.title ?? "Zhin Host API";
  const version = options.version ?? "0.0.0";

  const paths: Record<string, Record<string, unknown>> = {};
  const seen = new Set<string>();

  const sorted = [...routes].sort(
    (a, b) => a.pattern.localeCompare(b.pattern) || a.method.localeCompare(b.method),
  );

  for (const route of sorted) {
    const key = `${route.method}\0${route.pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const oaPath = patternToOpenApiPath(route.pattern);
    if (!paths[oaPath]) paths[oaPath] = {};
    const method = route.method.toLowerCase();
    paths[oaPath][method] = buildOperation(route, apiBase);
  }

  const doc: Record<string, unknown> = {
    openapi: "3.1.0",
    info: {
      title,
      version,
      description:
        "Runtime route catalog for this Zhin Host instance. Register routes via `useContext('router')`; optional OpenAPI metadata as the last non-function argument.",
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Set `Authorization: Bearer <http.token>` for paths under the configured API base.",
        },
      },
    },
  };

  if (options.serverUrl) {
    doc.servers = [{ url: options.serverUrl }];
  }

  return doc;
}
