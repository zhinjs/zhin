/**
 * GET /api/introspection/* — 内省列表 REST（Bearer）
 */
import type { Plugin } from '@zhin.js/core';
import {
  introspectionRestBindings,
  introspectionRestEndpoints,
  introspectionRestCommands,
  introspectionRestMcp,
  introspectionRestTools,
  type IntrospectionJsonResponse,
} from '@zhin.js/agent';
import {
  registerFetchRoute,
  type Router,
  type RouterContext,
} from '@zhin.js/host-router/router';

function queryFromCtx(ctx: RouterContext): Record<string, string | undefined> {
  const q = ctx.query as Record<string, string | string[] | undefined>;
  const out: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(q)) {
    if (typeof val === 'string') out[key] = val;
    else if (Array.isArray(val)) out[key] = val[0];
  }
  return out;
}

function sendJson(ctx: RouterContext, body: unknown, status = 200): void {
  ctx.status = status;
  ctx.body = body;
}

export function registerIntrospectionRoutes(
  router: Router,
  base: string,
  getRoot: () => Plugin,
): void {
  const routes: Array<{
    path: string;
    handler: (root: Plugin, q: Record<string, string | undefined>) => IntrospectionJsonResponse<unknown>;
  }> = [
    { path: 'commands', handler: introspectionRestCommands },
    { path: 'endpoints', handler: introspectionRestEndpoints },
    { path: 'bindings', handler: introspectionRestBindings },
    { path: 'tools', handler: introspectionRestTools },
    { path: 'mcp', handler: introspectionRestMcp },
  ];

  for (const { path, handler } of routes) {
    registerFetchRoute(router, 'GET', `${base}/introspection/${path}`, async (ctx: RouterContext) => {
      const root = getRoot();
      const result = handler(root, queryFromCtx(ctx));
      if (!result.success) {
        sendJson(ctx, result, 503);
        return;
      }
      sendJson(ctx, result);
    });
  }
}
