import {
  RouteTable,
  buildOpenApiDocument,
  createFetchApp,
  registerFetchRoute,
  type FetchApp,
  type RouterContext,
} from '@zhin.js/http-host/edge';
import { registerAdapterApiStubs } from '@zhin.js/http/adapter-api-stubs';
import { registerHostRestRoutes } from '@zhin.js/http/host-rest-api';
import { registerLogsRoutes } from '@zhin.js/http/logs-rest-api';
import { registerMarketplaceRoutes } from '@zhin.js/http/marketplace-rest-api';
import { registerConsoleRoutes } from '@zhin.js/console/console-api';
import { createDenoProjectFs } from '@zhin.js/console/rpc/project-fs';
import { createMemoryStoragePort } from '@zhin.js/storage-port';
import { QueueRuntime, registerQueueRoutes } from '@zhin.js/queue-runtime';
import {
  registerSandboxSseRoutes,
  registerSandboxWebSocketRoutes,
  type SandboxWsHostAdapter,
} from '@zhin.js/adapter-sandbox/edge';
import type { Plugin } from '@zhin.js/core';
import { getZhinProjectRoot } from '../setup/project-root.js';
import type { EdgeRuntimeConfig, HttpRuntimeConfig } from './types.js';

export type CreateEdgeHttpAppOptions = {
  plugin: Plugin;
  http: HttpRuntimeConfig;
  edge: EdgeRuntimeConfig;
  getSandboxAdapter: () => SandboxWsHostAdapter;
  getConsoleEntriesRecord: () => Record<string, string>;
  /** 额外路由（如 playground 的 /entries、/@assets） */
  registerAssetRoutes?: (table: RouteTable) => void;
  configPath?: string;
};

export function createEdgeHttpApp(options: CreateEdgeHttpAppOptions): FetchApp {
  const { http, edge, plugin } = options;
  const base = http.base;
  const table = new RouteTable();
  const storage = createMemoryStoragePort();
  const queue = new QueueRuntime(storage, { botId: edge.queueBotId });
  const projectFs = createDenoProjectFs(getZhinProjectRoot());

  registerQueueRoutes(table, base, queue);

  const sandbox = options.getSandboxAdapter();
  if (sandbox.transport === 'http-sse') {
    registerSandboxSseRoutes(table, options.getSandboxAdapter);
  } else {
    registerSandboxWebSocketRoutes(table, options.getSandboxAdapter);
  }

  options.registerAssetRoutes?.(table);

  registerHostRestRoutes(table, base, () => plugin);
  registerMarketplaceRoutes(table, base, () => plugin);
  registerLogsRoutes(table, base);
  registerAdapterApiStubs(table);
  registerConsoleRoutes(
    table,
    base,
    () => ({
      ws: { clients: new Set() },
      entries: options.getConsoleEntriesRecord(),
    } as { ws: import('ws').WebSocketServer; entries?: Record<string, string> }),
    {
      parity: edge.consoleParity,
      root: plugin,
      projectFs,
    },
  );

  registerFetchRoute(table, 'GET', '/api/info', (ctx: RouterContext) => {
    const hostHeader = ctx.get('host') ?? 'localhost';
    const proto = ctx.get('x-forwarded-proto') ?? 'http';
    const origin = `${proto}://${hostHeader}`;
    const apiBase = `${origin}${base}`;
    const transport = sandbox.transport;
    ctx.body = {
      name: 'Zhin Edge',
      config: options.configPath,
      sandboxTransport: transport,
      ...(transport === 'http-sse'
        ? {
          sandboxEvents: `${origin}/sandbox/events`,
          sandboxMessage: `${origin}/sandbox/message`,
        }
        : {}),
      apiBase: origin,
      openapi: `${origin}/pub/openapi.json`,
      health: `${origin}/pub/health`,
      consoleApi: `${apiBase}/console/request`,
      events: `${apiBase}/events`,
      queueIncoming: `${apiBase}/queue/incoming`,
      entries: `${origin}/entries`,
    };
  });

  registerFetchRoute(table, 'GET', '/pub/health', (ctx: RouterContext) => {
    ctx.body = {
      success: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      runtime: 'zhin-edge',
    };
  });

  registerFetchRoute(table, 'GET', '/pub/openapi.json', (ctx: RouterContext) => {
    const hostHeader = ctx.get('host') ?? 'localhost';
    const proto = ctx.get('x-forwarded-proto') ?? 'http';
    const serverUrl = `${proto}://${hostHeader}`;
    ctx.body = buildOpenApiDocument(table.listRoutes(), {
      title: 'Zhin Edge API',
      version: '0.2.0',
      apiBase: base,
      serverUrl,
    });
  });

  /** EventSource 无法带 Authorization；Console 静态与 Sandbox SSE 须始终可访问 */
  const authExemptPaths = [
    '/api/info',
    '/sandbox/events',
    '/sandbox/message',
    '/entries',
    '/@assets',
    '/esm',
    '/sandbox-ui',
    `${base}/events`,
    `${base}/console/request`,
  ];

  return createFetchApp(table, {
    base,
    token: http.token,
    corsOrigins: http.corsOrigins,
    trustProxy: http.trustProxy,
    authExemptPaths,
  });
}
