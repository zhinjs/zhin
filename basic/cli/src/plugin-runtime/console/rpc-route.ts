import {
  auditActor,
  authorizeConsoleRpc,
  dispatchRuntimeConsoleRpc,
  HttpBodyError,
  isUserPrincipal,
  pickRpcReply,
  pluginRpcWriteAllowed,
  principalAllows,
  readJsonBody,
  requestConsolePrincipal,
  rpcAuditDetail,
  rpcAuditTarget,
  unrestrictedConsoleAccess,
  type ConsolePrincipal,
  type ConsoleRpcDecision,
  type HttpHost,
} from '@zhin.js/host-http';
import type { IncomingMessage } from 'node:http';
import { writeJson } from './http-response.js';
import {
  ConsoleRpcRequestScope,
} from './rpc-context.js';
import type { AgentConsolePort } from './agent-console.js';
import type { ConsoleRpcComposition } from './rpc-composition.js';
import { dispatchPluginConsoleRpcRequest } from './plugin-console-rpc.js';
import { dispatchIamRpc, isIamRpc } from './iam/rpc.js';
import { createFeatureRpcContext, dispatchFeatureConsoleRpc } from './console-feature-rpc.js';
import type { ConsoleScopeTarget } from '@zhin.js/console-protocol';
import type { ConsoleIamService } from './iam/service.js';

export interface RegisterConsoleRpcRouteOptions extends ConsoleRpcComposition {
  readonly http: HttpHost;
  readonly base: string;
  /** Console access control (ADR 0049); `iam.*` answers 503 without it. */
  readonly consoleIam?: () => ConsoleIamService | undefined;
}

const OPEN_HOST: ConsolePrincipal = Object.freeze({ kind: 'bootstrap', open: true });

/** The Host binds a principal to every `/api` request; a bare test host without credentials is open. */
function rpcPrincipal(http: HttpHost, request: IncomingMessage): ConsolePrincipal | undefined {
  return requestConsolePrincipal(request) ?? (http.tokenRegistry?.hasAnyToken() ? undefined : OPEN_HOST);
}

export function registerConsoleRpcRoute(options: RegisterConsoleRpcRouteOptions): void {
  const { http, base } = options;

  http.route('POST', `${base}/console/request`, async (
    request, response, _url, authScope, authenticatedPrincipal,
  ) => {
    let principal: ConsolePrincipal | undefined;
    let message: Record<string, unknown> = {};
    let decision: ConsoleRpcDecision | undefined;
    const audit = (outcome: 'ok' | 'denied' | 'error') => {
      if (!decision) return;
      if (outcome !== 'denied' && !(decision.allowed && decision.write)) return;
      try {
        http.tokenRegistry?.accessProvider?.audit?.({
          actor: auditActor(principal),
          action: `rpc:${String(message.type ?? '')}`.slice(0, 256),
          ...(decision.allowed && rpcAuditTarget(decision.rule) ? { target: rpcAuditTarget(decision.rule)! } : {}),
          outcome,
          detail: rpcAuditDetail(message),
          ...(request.socket?.remoteAddress ? { ip: request.socket.remoteAddress } : {}),
        });
      } catch { /* audit never breaks a request */ }
    };
    const reply = (status: number, body: Record<string, unknown>) => {
      if (decision?.allowed && decision.write) audit(status < 400 && body.success !== false ? 'ok' : 'error');
      writeJson(response, status, body);
    };
    try {
      message = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
      principal = rpcPrincipal(http, request);
      if (!principal) {
        writeJson(response, 401, { success: false, code: 'unauthorized', error: 'Invalid or missing token', requestId: message.requestId });
        return;
      }
      decision = authorizeConsoleRpc(principal, message);
      if (!decision.allowed) {
        audit('denied');
        writeJson(response, 403, { success: false, code: decision.code, error: decision.error, requestId: message.requestId });
        return;
      }
      const access = http.tokenRegistry?.accessFor(principal) ?? unrestrictedConsoleAccess;
      if (isIamRpc(message.type)) {
        const result = await dispatchIamRpc(message, options.consoleIam?.(), principal);
        response.setHeader('cache-control', 'no-store');
        reply(result.status, result.body);
        return;
      }
      const authorizedPrincipal = principal;
      const featureReply = await dispatchFeatureConsoleRpc(message, createFeatureRpcContext(options, authScope,
        request => principalAllows(authorizedPrincipal, request.permission, featureTarget(request.level, request.key))));
      if (featureReply) {
        response.setHeader('cache-control', 'no-store');
        reply(featureReply.status, featureReply.body);
        return;
      }
      // `plugin.<pluginId>.<method>`: the gate admitted the read permission; writes need the write one.
      const pluginReply = await dispatchPluginConsoleRpcRequest(message, {
        snapshots: options.snapshots,
        access,
        ...(principal.kind === 'bootstrap' ? {} : {
          principalGrant: Object.freeze({ write: pluginRpcWriteAllowed(principal, decision.rule) }),
        }),
        ...(options.hostConsoleRpc ? { hostRpc: options.hostConsoleRpc } : {}),
      });
      if (pluginReply) {
        response.setHeader('cache-control', 'no-store');
        reply(pluginReply.status, pluginReply.body as Record<string, unknown>);
        return;
      }
      const requestScope = new ConsoleRpcRequestScope(options, {
        authScope,
        authenticatedPrincipal,
        access,
      });
      let payloads: Awaited<ReturnType<typeof dispatchRuntimeConsoleRpc>>;
      try {
        const collaborationReply = await dispatchAgentCollaborationRpc(message, requestScope.agent);
        if (collaborationReply) {
          reply(collaborationReply.status, collaborationReply.body);
          return;
        }
        payloads = await dispatchRuntimeConsoleRpc(message, { ...requestScope.context, principal });
      } finally {
        requestScope.close();
      }
      const match = pickRpcReply(message, payloads);
      if (!match) {
        reply(500, { success: false, error: 'No response' });
        return;
      }
      if (match.error) {
        reply(400, {
          success: false,
          error: match.error,
          ...(match.data !== undefined ? { data: match.data } : {}),
          requestId: match.requestId,
        });
        return;
      }
      reply(200, {
        success: true,
        data: scopedEndpointList(principal, message.type, match.data),
        type: match.type,
        requestId: match.requestId,
      });
    } catch (error) {
      if (error instanceof HttpBodyError) {
        writeJson(response, error.statusCode, { success: false, error: error.message });
        return;
      }
      reply(500, {
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

/**
 * Scope target of a `feature.*` operation (ADR 0049 §3): `adapter` key `<alias>`, `endpoint` key
 * `<alias>/<endpointId>`. Calls without a level (list / matrix, global writes) need a global binding.
 */
function featureTarget(level: string | undefined, key: string | undefined): ConsoleScopeTarget {
  if (level === 'adapter' && key && !key.includes('/')) return { kind: 'adapter', adapter: key };
  if (level === 'endpoint' && key) {
    const slash = key.indexOf('/');
    if (slash > 0 && slash < key.length - 1) return { kind: 'endpoint', adapter: key.slice(0, slash), endpoint: key.slice(slash + 1) };
  }
  return { kind: 'global' };
}

/** `endpoint.list` for an adapter/endpoint-scoped user only shows the accounts it covers. */
function scopedEndpointList(principal: ConsolePrincipal, type: unknown, data: unknown): unknown {
  if (type !== 'endpoint.list' || !isUserPrincipal(principal) || principalAllows(principal, 'endpoint.view')) return data;
  const record = data && typeof data === 'object' ? data as { endpoints?: unknown } : undefined;
  if (!record || !Array.isArray(record.endpoints)) return data;
  return {
    ...record,
    endpoints: record.endpoints.filter((entry) => {
      const item = entry as { adapter?: unknown; name?: unknown; endpoint?: { id?: unknown; adapter?: unknown } };
      const adapter = String(item.endpoint?.adapter ?? item.adapter ?? '');
      const endpoint = String(item.endpoint?.id ?? item.name ?? '');
      return principalAllows(principal, 'endpoint.view', { kind: 'endpoint', adapter, endpoint });
    }),
  };
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
