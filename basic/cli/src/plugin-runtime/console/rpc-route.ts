import {
  dispatchRuntimeConsoleRpc,
  HttpBodyError,
  pickRpcReply,
  readJsonBody,
  unrestrictedConsoleAccess,
  type HttpHost,
} from '@zhin.js/host-http';
import { writeJson } from './http-response.js';
import {
  ConsoleRpcRequestScope,
} from './rpc-context.js';
import type { AgentConsolePort } from './agent-console.js';
import type { ConsoleRpcComposition } from './rpc-composition.js';
import { assertDemoConsoleRpcAllowed } from '@zhin.js/console-protocol';
import { dispatchPluginConsoleRpcRequest } from './plugin-console-rpc.js';
import { requestConsoleAccess } from './entry-projection.js';

export interface RegisterConsoleRpcRouteOptions extends ConsoleRpcComposition {
  readonly http: HttpHost;
  readonly base: string;
}

export function registerConsoleRpcRoute(options: RegisterConsoleRpcRouteOptions): void {
  const { http, base } = options;

  http.route('POST', `${base}/console/request`, async (
    request, response, url, authScope, authenticatedPrincipal,
  ) => {
    try {
      const message = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
      // A full-scope caller is the operator even when the Host has no tokens configured.
      const access = authScope === 'full' ? undefined : requestConsoleAccess(http, request, url);
      // `plugin.<pluginId>.<method>` is plugin-registered and authorizes itself against its Page.
      const pluginReply = await dispatchPluginConsoleRpcRequest(message, {
        snapshots: options.snapshots,
        access: access ?? unrestrictedConsoleAccess,
        ...(options.hostConsoleRpc ? { hostRpc: options.hostConsoleRpc } : {}),
      });
      if (pluginReply) {
        response.setHeader('cache-control', 'no-store');
        writeJson(response, pluginReply.status, pluginReply.body);
        return;
      }
      if (authScope === 'demo') {
        const denied = assertDemoConsoleRpcAllowed(String(message.type ?? ''));
        if (denied) {
          writeJson(response, 403, { success: false, error: denied, requestId: message.requestId });
          return;
        }
      }
      const requestScope = new ConsoleRpcRequestScope(options, {
        authScope,
        authenticatedPrincipal,
        access: access ?? unrestrictedConsoleAccess,
      });
      let payloads: Awaited<ReturnType<typeof dispatchRuntimeConsoleRpc>>;
      try {
        const collaborationReply = await dispatchAgentCollaborationRpc(message, requestScope.agent);
        if (collaborationReply) {
          writeJson(response, collaborationReply.status, collaborationReply.body);
          return;
        }
        payloads = await dispatchRuntimeConsoleRpc(message, requestScope.context);
      } finally {
        requestScope.close();
      }
      const match = pickRpcReply(message, payloads);
      if (!match) {
        writeJson(response, 500, { success: false, error: 'No response' });
        return;
      }
      if (match.error) {
        writeJson(response, 400, {
          success: false,
          error: match.error,
          ...(match.data !== undefined ? { data: match.data } : {}),
          requestId: match.requestId,
        });
        return;
      }
      writeJson(response, 200, {
        success: true,
        data: match.data,
        type: match.type,
        requestId: match.requestId,
      });
    } catch (error) {
      if (error instanceof HttpBodyError) {
        writeJson(response, error.statusCode, { success: false, error: error.message });
        return;
      }
      writeJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'Console RPC',
    tags: ['console'],
    description: 'Plugin Runtime Console request envelope: `{ type, data?, requestId? }`.',
  });
}

async function dispatchAgentCollaborationRpc(
  message: Record<string, unknown>,
  agent: AgentConsolePort | null,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const type = typeof message.type === 'string' ? message.type : '';
  if (
    type !== 'agent.engagements.list'
    && type !== 'agent.engagements.get'
    && type !== 'agent.venues.list'
  ) {
    return null;
  }
  if (!agent) {
    return {
      status: 503,
      body: {
        success: false,
        error: 'Agent Runtime 尚未就绪',
        requestId: message.requestId,
      },
    };
  }
  const payload = message.data && typeof message.data === 'object' && !Array.isArray(message.data)
    ? message.data as Record<string, unknown>
    : message;

  if (type === 'agent.engagements.list') {
    const rawLimit = Number(payload.limit ?? 50);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(200, Math.floor(rawLimit)) : 50;
    const engagements = agent.engagements ? await agent.engagements.list(limit) : [];
    return {
      status: 200,
      body: {
        success: true,
        data: { engagements },
        type,
        requestId: message.requestId,
      },
    };
  }

  if (type === 'agent.engagements.get') {
    const engagementId = typeof payload.engagementId === 'string'
      ? payload.engagementId.trim()
      : typeof payload.id === 'string'
        ? payload.id.trim()
        : '';
    if (!engagementId) {
      return {
        status: 400,
        body: {
          success: false,
          error: '请提供有效的 engagementId',
          requestId: message.requestId,
        },
      };
    }
    const detail = agent.engagements ? await agent.engagements.get(engagementId) : null;
    if (!detail) {
      return {
        status: 404,
        body: {
          success: false,
          error: 'Engagement 不存在',
          requestId: message.requestId,
        },
      };
    }
    return {
      status: 200,
      body: {
        success: true,
        data: detail,
        type,
        requestId: message.requestId,
      },
    };
  }

  // agent.venues.list
  const venues = agent.venues ? agent.venues.list() : [];
  return {
    status: 200,
    body: {
      success: true,
      data: { venues },
      type,
      requestId: message.requestId,
    },
  };
}
