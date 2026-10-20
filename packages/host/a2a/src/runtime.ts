import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  type A2ARequestHandler,
} from '@a2a-js/sdk/server';
import { AGENT_CARD_PATH, type AgentCard } from '@a2a-js/sdk';
import type { HttpRouteHost } from '@zhin.js/host-http-contract';
import type { AgentHostPort } from '@zhin.js/agent/runtime';
import { buildAgentCardForBinding } from './card-builder.js';
import { ZhinA2AExecutor } from './agent-executor.js';
import { handleAgentCard, handleJsonRpc, handleRest } from './http-handlers.js';
import { verifyA2aBearer } from './auth.js';
import type { WorkroomA2aAuthBindingInput } from './workroom-auth-registry.js';
import type { WorkroomA2aRemoteTransportBindingInput } from './workroom-remote-transport.js';

export interface RuntimeWorkroomCallbackConfig {
  readonly enabled?: boolean;
  /** Must remain outside the ordinary `/a2a/{agent}/*` route tree. */
  readonly path?: string;
  readonly maxBodyBytes?: number;
  readonly maxSequenceGap?: number;
  readonly bindings: readonly WorkroomA2aAuthBindingInput[];
}

export interface RuntimeWorkroomRemoteExecutorsConfig {
  readonly enabled?: boolean;
  readonly maxResponseBytes?: number;
  readonly bindings: readonly WorkroomA2aRemoteTransportBindingInput[];
}

export interface RuntimeA2aConfig {
  readonly enabled?: boolean;
  readonly path?: string;
  readonly token?: string;
  readonly publicUrl?: string;
  readonly workroomCallbacks?: RuntimeWorkroomCallbackConfig;
  /** Transport endpoints only. Project/Workroom topology remains in the persistent Catalog. */
  readonly workroomRemoteExecutors?: RuntimeWorkroomRemoteExecutorsConfig;
}

export interface InstallRuntimeA2aOptions {
  readonly http: HttpRouteHost;
  readonly agentHost: AgentHostPort;
  readonly config?: RuntimeA2aConfig;
  readonly fallbackToken?: string;
  readonly fallbackPublicUrl: string;
  readonly production?: boolean;
}

interface AgentStack {
  readonly card: AgentCard;
  readonly handler: A2ARequestHandler;
}

/** Mount Agent Card, JSON-RPC, and HTTP+JSON routes on the Runtime HTTP Host. */
export function installRuntimeA2a(options: InstallRuntimeA2aOptions): () => void {
  if (options.config?.enabled === false) return () => undefined;
  const basePath = normalizePath(options.config?.path ?? '/a2a');
  const publicBaseUrl = trimTrailingSlashes(options.config?.publicUrl ?? options.fallbackPublicUrl);
  const token = options.config?.token ?? options.fallbackToken ?? '';
  if (options.production === true && !token) {
    throw new Error('A2A requires a2a.token or http.token in production');
  }
  const stacks = new Map<string, AgentStack>();

  for (const binding of options.agentHost.protocol.listBindings()) {
    const agentName = binding.name;
    const card = buildAgentCardForBinding(binding, publicBaseUrl, basePath);
    const executor = new ZhinA2AExecutor({
      agentName,
      protocol: options.agentHost.protocol,
    });
    stacks.set(agentName, {
      card,
      handler: new DefaultRequestHandler(card, new InMemoryTaskStore(), executor),
    });
  }

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

function trimTrailingSlashes(s: string): string {
  let i = s.length;
  while (i > 0 && s[i - 1] === '/') i--;
  return s.slice(0, i);
}

function normalizePath(path: string): string {
  const leading = path.startsWith('/') ? path : `/${path}`;
  return trimTrailingSlashes(leading) || '/a2a';
}

export {
  installRuntimeWorkroomCallbacks,
  type InstallRuntimeWorkroomCallbacksOptions,
  type RuntimeWorkroomCallbackDependencies,
  type RuntimeWorkroomCallbackInstallation,
  type RuntimeWorkroomCallbackRecoverySummary,
} from './workroom-callback-runtime.js';
export {
  WorkroomA2aAuthRegistry,
  WorkroomA2aAuthenticationError,
  type WorkroomA2aAuthRegistryOptions,
  type WorkroomA2aEndpointAuthoritySnapshot,
} from './workroom-auth-registry.js';
export {
  WorkroomA2aHttpRemoteTransport,
  type WorkroomA2aHttpRemoteTransportOptions,
  type WorkroomA2aPinnedNetworkPort,
  type WorkroomA2aPinnedRequest,
  type WorkroomA2aResolvedAddress,
  type WorkroomA2aRemoteTransportBindingInput,
} from './workroom-remote-transport.js';
