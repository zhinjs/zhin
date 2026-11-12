import { DefaultRequestHandler, type A2ARequestHandler } from '@a2a-js/sdk/server';
import { AGENT_CARD_PATH, type AgentCard } from '@a2a-js/sdk';
import { jsonResponse, type HttpRouteHost } from '@zhin.js/host-http-contract';
import type { AgentHostPort } from '@zhin.js/agent/runtime';
import { buildAgentCardForBinding } from './card-builder.js';
import { ZhinA2AExecutor } from './agent-executor.js';
import { handleAgentCard, handleJsonRpc, handleRest } from './http-handlers.js';
import { extractBearerToken, isLocalhost, verifyA2aBearer } from './auth.js';
import { BoundedTaskStore } from './bounded-task-store.js';
import type { RuntimeA2aMailboxConfig } from './mailbox-remote-transport.js';

export interface RuntimeA2aConfig {
  readonly enabled?: boolean;
  readonly path?: string;
  readonly token?: string;
  readonly publicUrl?: string;
  readonly mailbox?: RuntimeA2aMailboxConfig;
}

export interface InstallRuntimeA2aOptions {
  readonly http: HttpRouteHost;
  readonly agentHost: AgentHostPort;
  readonly config?: RuntimeA2aConfig;
  readonly fallbackToken?: string;
  /**
   * Shared Host credential check (ADR 0049): user API tokens with `a2a.access`, or the
   * bootstrap token before setup. Tried when the bearer does not match `config.token`.
   */
  /** `principal`: what the Host (or the gateway in front of it) resolved from that bearer. */
  readonly authenticateBearer?: (token: string, request: Request, remoteAddress?: string, principal?: unknown) => Promise<boolean>;
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
  if (options.production === true && !token && !options.authenticateBearer) {
    throw new Error('A2A requires a2a.token or Host API tokens in production');
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
      handler: new DefaultRequestHandler(card, new BoundedTaskStore(), executor),
    });
  }

  const unregister = options.http.route('ALL', `${basePath}/*`, async (request, { url, remoteAddress, principal }) => {
    // No token (non-production only): accept loopback callers alone, like the MCP Host,
    // so a token-less dev instance is not open to the network.
    const auth = { headers: request.headers, ...(remoteAddress ? { remoteAddress } : {}) };
    const bearer = extractBearerToken(auth);
    const authenticated = (token !== '' && verifyA2aBearer(auth, token))
      || (bearer !== '' && options.authenticateBearer !== undefined
        && await options.authenticateBearer(bearer, request, remoteAddress, principal).catch(() => false))
      || (token === '' && options.production !== true && isLocalhost(auth));
    if (!authenticated) {
      return jsonResponse(401, { error: 'Unauthorized - Bearer token required' });
    }
    const route = parseRoute(url.pathname, basePath);
    if (!route) {
      return jsonResponse(404, { error: 'Not found' });
    }
    const stack = stacks.get(route.agentName);
    if (!stack) {
      return jsonResponse(404, { error: `A2A agent "${route.agentName}" not found` });
    }
    if (route.kind === 'card') return handleAgentCard(request, stack.handler);
    if (route.kind === 'jsonrpc') return handleJsonRpc(request, stack.handler);
    return handleRest(request, stack.handler, route.restPath);
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
  A2AMailboxTransport,
  DEFAULT_A2A_MAILBOX_PATH,
  installRuntimeA2aMailbox,
  signMailboxEnvelope,
  verifyMailboxEnvelope,
  type A2AMailboxEnvelope,
  type A2AMailboxInboundHandler,
  type A2AMailboxPeerConfig,
  type A2AMailboxTransportOptions,
  type A2AMailboxUnsignedPayload,
  type InstallRuntimeA2aMailboxOptions,
  type RuntimeA2aMailboxConfig,
  type RuntimeA2aMailboxInstallation,
  type VerifyMailboxEnvelopeResult,
} from './mailbox-remote-transport.js';
