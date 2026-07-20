import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  type A2ARequestHandler,
} from '@a2a-js/sdk/server';
import { AGENT_CARD_PATH, type AgentCard } from '@a2a-js/sdk';
import type { HttpHost } from '@zhin.js/host-http';
import type { AgentHostPort } from '@zhin.js/agent/runtime';
import type { ZhinAgent } from '@zhin.js/agent';
import type { AgentBindingRegistry } from '@zhin.js/agent/config';
import { buildAgentCardForBinding, listExposableAgentNames } from './card-builder.js';
import { ZhinA2AExecutor } from './agent-executor.js';
import { handleAgentCard, handleJsonRpc, handleRest } from './http-handlers.js';
import { verifyA2aBearer } from './auth.js';

export interface RuntimeA2aConfig {
  readonly enabled?: boolean;
  readonly path?: string;
  readonly token?: string;
  readonly publicUrl?: string;
}

export interface InstallRuntimeA2aOptions {
  readonly http: HttpHost;
  readonly agentHost: AgentHostPort;
  readonly config?: RuntimeA2aConfig;
  readonly fallbackToken?: string;
  readonly fallbackPublicUrl: string;
}

interface AgentStack {
  readonly card: AgentCard;
  readonly handler: A2ARequestHandler;
}

/** Mount Agent Card, JSON-RPC, and HTTP+JSON routes on the Runtime HTTP Host. */
export function installRuntimeA2a(options: InstallRuntimeA2aOptions): () => void {
  if (options.config?.enabled === false) return () => undefined;
  const basePath = normalizePath(options.config?.path ?? '/a2a');
  const publicBaseUrl = (options.config?.publicUrl ?? options.fallbackPublicUrl).replace(/\/+$/u, '');
  const service = options.agentHost.service as {
    getBindingRegistry(): AgentBindingRegistry;
  };
  const agent = options.agentHost.agent as ZhinAgent;
  const registry = service.getBindingRegistry();
  const stacks = new Map<string, AgentStack>();

  for (const agentName of listExposableAgentNames(registry)) {
    const card = buildAgentCardForBinding(agentName, registry, publicBaseUrl, basePath);
    if (!card) continue;
    const executor = new ZhinA2AExecutor({
      agentName,
      getAgent: () => agent,
      resolveBinding: () => registry.getBinding(agentName),
    });
    stacks.set(agentName, {
      card,
      handler: new DefaultRequestHandler(card, new InMemoryTaskStore(), executor),
    });
  }

  const token = options.config?.token ?? options.fallbackToken ?? '';
  const unregister = options.http.route('ALL', `${basePath}/*`, async (request, response, url) => {
    if (token && !verifyA2aBearer(request, token)) {
      writeJson(response, 401, { error: 'Unauthorized - Bearer token required' });
      return;
    }
    const route = parseRoute(url.pathname, basePath);
    if (!route) {
      writeJson(response, 404, { error: 'Not found' });
      return;
    }
    const stack = stacks.get(route.agentName);
    if (!stack) {
      writeJson(response, 404, { error: `A2A agent "${route.agentName}" not found` });
      return;
    }
    if (route.kind === 'card') {
      await handleAgentCard(request, response, stack.handler);
    } else if (route.kind === 'jsonrpc') {
      await handleJsonRpc(request, response, stack.handler);
    } else {
      await handleRest(request, response, stack.handler, route.restPath);
    }
  }, { summary: 'Agent-to-Agent protocol', tags: ['a2a'] });

  return () => {
    unregister();
    stacks.clear();
  };
}

type ParsedRoute =
  | { readonly agentName: string; readonly kind: 'card' }
  | { readonly agentName: string; readonly kind: 'jsonrpc' }
  | { readonly agentName: string; readonly kind: 'rest'; readonly restPath: string };

function parseRoute(pathname: string, basePath: string): ParsedRoute | null {
  const prefix = `${basePath}/`;
  if (!pathname.startsWith(prefix)) return null;
  const slash = pathname.indexOf('/', prefix.length);
  if (slash < 0) return null;
  let agentName: string;
  try {
    agentName = decodeURIComponent(pathname.slice(prefix.length, slash));
  } catch {
    return null;
  }
  if (!agentName) return null;
  const tail = pathname.slice(slash + 1).replace(/^\/+|\/+$/gu, '');
  if (tail === `.well-known/${AGENT_CARD_PATH}` || tail === '.well-known/agent-card.json') {
    return { agentName, kind: 'card' };
  }
  if (tail === 'jsonrpc' || tail.startsWith('jsonrpc/')) {
    return { agentName, kind: 'jsonrpc' };
  }
  if (tail === 'rest' || tail.startsWith('rest/')) {
    return {
      agentName,
      kind: 'rest',
      restPath: tail === 'rest' ? '' : tail.slice('rest/'.length),
    };
  }
  return null;
}

function writeJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
  });
  response.end(payload);
}

function normalizePath(path: string): string {
  const leading = path.startsWith('/') ? path : `/${path}`;
  return leading.replace(/\/+$/u, '') || '/a2a';
}
