/**
 * Zhin Edge Fetch handler — 复用 Host 同款 Console/Queue 注册（@zhin.js/console dispatch + queue-runtime）。
 */
import {
  RouteTable,
  buildOpenApiDocument,
  createFetchApp,
  registerFetchRoute,
} from "@zhin.js/http-host/edge";
import { registerAdapterApiStubs } from "@zhin.js/http/adapter-api-stubs";
import { registerEntriesRoute, registerHostRestRoutes } from "@zhin.js/http/host-rest-api";
import { registerLogsRoutes } from "@zhin.js/http/logs-rest-api";
import { registerMarketplaceRoutes } from "@zhin.js/http/marketplace-rest-api";
import { registerConsoleRoutes } from "@zhin.js/console/console-api";
import { createDenoProjectFs } from "@zhin.js/console/rpc/project-fs";
import { createMemoryStoragePort } from "@zhin.js/storage-port";
import { QueueRuntime, registerQueueRoutes } from "@zhin.js/queue-runtime";
import type { PlaygroundEdgeConfig, PlaygroundHttpConfig } from "./runtime/http-config.ts";
import { getPlaygroundEdgeConfig, getRootPlugin } from "./runtime/bootstrap.ts";
import { resolveProjectRoot } from "./runtime/load-config.ts";

export type EdgeHttpOptions = PlaygroundHttpConfig & {
  edge?: PlaygroundEdgeConfig;
};

export function createEdgeHttpApp(options: EdgeHttpOptions) {
  const base = options.base;
  const edge = options.edge ?? getPlaygroundEdgeConfig();
  const table = new RouteTable();
  const storage = createMemoryStoragePort();
  const queue = new QueueRuntime(storage, { botId: edge.queueBotId });
  const projectRoot = resolveProjectRoot();
  const projectFs = createDenoProjectFs(projectRoot);

  registerQueueRoutes(table, base, queue);
  registerEntriesRoute(table, { getBody: () => ({ entries: [], runtimeEnvHint: "development" }) });
  registerHostRestRoutes(table, base, getRootPlugin);
  registerMarketplaceRoutes(table, base, getRootPlugin);
  registerLogsRoutes(table, base);
  registerAdapterApiStubs(table);
  registerConsoleRoutes(
    table,
    base,
    () => ({ entries: {} }),
    {
      parity: edge.consoleParity,
      root: getRootPlugin(),
      projectFs,
    },
  );

  registerFetchRoute(table, "GET", "/pub/health", (ctx) => {
    ctx.body = {
      success: true,
      status: "ok",
      timestamp: new Date().toISOString(),
      runtime: "zhin-edge",
    };
  });

  registerFetchRoute(table, "GET", "/pub/openapi.json", (ctx) => {
    const hostHeader = ctx.get("host") ?? "localhost";
    const proto = ctx.get("x-forwarded-proto") ?? "http";
    const serverUrl = `${proto}://${hostHeader}`;
    ctx.body = buildOpenApiDocument(table.listRoutes(), {
      title: "Zhin Edge API",
      version: "0.2.0",
      apiBase: base,
      serverUrl,
    });
  });

  return createFetchApp(table, {
    base,
    token: options.token,
    corsOrigins: options.corsOrigins,
    trustProxy: options.trustProxy,
  });
}
