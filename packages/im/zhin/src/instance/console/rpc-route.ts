import {
  auditActor,
  authorizeConsoleRpc,
  dispatchRuntimeConsoleRpc,
  HttpBodyError,
  isUserPrincipal,
  jsonResponse,
  loginAuditDetail,
  pickRpcReply,
  principalAllows,
  readJsonBody,
  rpcAuditDetail,
  rpcAuditTarget,
  unrestrictedConsoleAccess,
  type ConsolePrincipal,
  type ConsoleRpcDecision,
  type HttpHost,
} from '@zhin.js/host-http';
import {
  ConsoleRpcRequestScope,
} from './rpc-context.js';
import type { AgentConsolePort } from './agent-console.js';
import type { ConsoleRpcComposition } from './rpc-composition.js';
import { dispatchPluginConsoleRpcRequest } from './plugin-console-rpc.js';
import { dispatchIamRpc, isIamRpc } from '@zhin.js/gateway/iam';
import { createFeatureRpcContext, dispatchFeatureConsoleRpc } from './console-feature-rpc.js';
import { dispatchChatRolesConsoleRpc } from './chat-roles-rpc.js';
import { CONSOLE_PERMISSIONS, featureScopeTarget } from '@zhin.js/console-protocol';
import type { ConsoleIamService } from '@zhin.js/gateway/iam';
import { internalErrorResponse } from './internal-error.js';

export interface RegisterConsoleRpcRouteOptions extends ConsoleRpcComposition {
  readonly http: HttpHost;
  readonly base: string;
  /** Console access control (ADR 0049); `iam.*` answers 503 without it. */
  readonly consoleIam?: () => ConsoleIamService | undefined;
}

const OPEN_HOST: ConsolePrincipal = Object.freeze({ kind: 'bootstrap', open: true });

/** The Host resolves a principal for every `/api` request; a bare test host without credentials is open. */
function rpcPrincipal(http: HttpHost, resolved: ConsolePrincipal | undefined): ConsolePrincipal | undefined {
  return resolved ?? (http.tokenRegistry?.hasAnyToken() ? undefined : OPEN_HOST);
}

export function registerConsoleRpcRoute(options: RegisterConsoleRpcRouteOptions): void {
  const { http, base } = options;
  // Console SQL is recorded with its literals redacted by the database Host's own lexer.
  const redactSql = options.databaseHost?.console?.redactSql;
  const auditOptions = redactSql ? { redactSql: (sql: string) => redactSql(sql) } : undefined;

  http.route('POST', `${base}/console/request`, async (request, context) => {
    const authScope = 'full' as const;
    let principal: ConsolePrincipal | undefined;
    let message: Record<string, unknown> = {};
    let decision: ConsoleRpcDecision | undefined;
    const audit = (outcome: 'ok' | 'denied' | 'error', body?: Record<string, unknown>) => {
      if (!decision) return;
      if (outcome !== 'denied' && !(decision.allowed && decision.write)) return;
      try {
        // ADR 0058: login actions also record their result category (never values or messages).
        const login = loginAuditDetail(message.type, body?.data);
        http.tokenRegistry?.accessProvider?.audit?.({
          actor: auditActor(principal),
          action: `rpc:${String(message.type ?? '')}`.slice(0, 256),
          ...(decision.allowed && rpcAuditTarget(decision.rule) ? { target: rpcAuditTarget(decision.rule)! } : {}),
          outcome,
          detail: login ? { ...rpcAuditDetail(message, body, auditOptions), ...login } : rpcAuditDetail(message, body, auditOptions),
          ...(context.remoteAddress ? { ip: context.remoteAddress } : {}),
        });
      } catch { /* audit never breaks a request */ }
    };
    const reply = (status: number, body: Record<string, unknown>, headers?: HeadersInit) => {
      if (decision?.allowed && decision.write) audit(status < 400 && body.success !== false ? 'ok' : 'error', body);
      return jsonResponse(status, body, headers);
    };
    const noStore = { 'cache-control': 'no-store' };
    try {
      message = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
      principal = rpcPrincipal(http, context.principal);
      if (!principal) {
        return jsonResponse(401, { success: false, code: 'unauthorized', error: 'Invalid or missing token', requestId: message.requestId });
      }
      decision = authorizeConsoleRpc(principal, message);
      if (!decision.allowed) {
        audit('denied');
        return jsonResponse(403, { success: false, code: decision.code, error: decision.error, requestId: message.requestId });
      }
      const access = http.tokenRegistry?.accessFor(principal) ?? unrestrictedConsoleAccess;
      if (isIamRpc(message.type)) {
        const result = await dispatchIamRpc(message, options.consoleIam?.(), principal);
        return reply(result.status, result.body, noStore);
      }
      const authorizedPrincipal = principal;
      // Scoped bindings count for every scope under them (a conversation counts for its endpoint).
      const featureReply = await dispatchFeatureConsoleRpc(message, createFeatureRpcContext(options, authScope,
        request => principalAllows(authorizedPrincipal, request.permission, featureScopeTarget(request.level, request.key)),
        auditActor(principal),
        // Overrides are environment-expanded: only principals that may edit `.env` themselves
        // (owners, `ops.env.write`) may plant `${…}` / `env://` references through feature.*.
        () => principalAllows(authorizedPrincipal, CONSOLE_PERMISSIONS.OPS_ENV_WRITE)));
      if (featureReply) {
        return reply(featureReply.status, featureReply.body, noStore);
      }
      // ADR 0056 §3: chat roles; adapter / endpoint-scoped `iam.manage` counts under its scope.
      const chatRolesReply = await dispatchChatRolesConsoleRpc(message, {
        ...(options.featureStores?.roles ? { roles: options.featureStores.roles } : {}),
        authorize: request => principalAllows(authorizedPrincipal, request.permission, featureScopeTarget(request.level, request.key)),
        actor: auditActor(principal),
        publishEvent: (type, data) => options.hub.publish(type, data),
      });
      if (chatRolesReply) {
        return reply(chatRolesReply.status, chatRolesReply.body, noStore);
      }
      // `plugin.<pluginId>.<method>`: the dispatcher authorizes signed-in principals per method
      // (its own, its Page's, or the catalog fallback permission).
      const pluginReply = await dispatchPluginConsoleRpcRequest(message, {
        snapshots: options.snapshots,
        access,
        ...(isUserPrincipal(principal) ? {
          principal: Object.freeze({
            grants: principal.grants,
            roles: principal.roles,
            rule: decision.rule,
            ...(http.tokenRegistry ? { levelOf: http.tokenRegistry.pluginPermissionLevels() } : {}),
          }),
        } : {}),
        ...(options.hostConsoleRpc ? { hostRpc: options.hostConsoleRpc } : {}),
      });
      if (pluginReply) {
        if (pluginReply.status === 403 && !pluginReply.body.success && pluginReply.body.code === 'forbidden' && !decision.write) {
          audit('denied');
        }
        return reply(pluginReply.status, pluginReply.body as Record<string, unknown>, noStore);
      }
      if (decision.delegated) {
        // Admitted only for the plugin dispatcher: nothing else may answer it.
        audit('denied');
        return jsonResponse(403, { success: false, code: 'forbidden', error: '没有操作权限', requestId: message.requestId });
      }
      const requestScope = new ConsoleRpcRequestScope(options, {
        authScope,
        ...(isUserPrincipal(principal)
          ? { authenticatedPrincipal: Object.freeze({ principalId: `user:${principal.userId}`, scope: authScope }) }
          : {}),
        access,
      });
      let payloads: Awaited<ReturnType<typeof dispatchRuntimeConsoleRpc>>;
      try {
        const collaborationReply = await dispatchAgentCollaborationRpc(message, requestScope.agent);
        if (collaborationReply) {
          return reply(collaborationReply.status, collaborationReply.body);
        }
        payloads = await dispatchRuntimeConsoleRpc(message, { ...requestScope.context, principal });
      } finally {
        requestScope.close();
      }
      const match = pickRpcReply(message, payloads);
      if (!match) {
        return reply(500, { success: false, error: 'No response' });
      }
      if (match.error) {
        return reply(400, {
          success: false,
          error: match.error,
          ...(match.data !== undefined ? { data: match.data } : {}),
          requestId: match.requestId,
        });
      }
      return reply(200, {
        success: true,
        data: scopedEndpointList(principal, message.type, match.data),
        type: match.type,
        requestId: match.requestId,
      });
    } catch (error) {
      if (error instanceof HttpBodyError) {
        return jsonResponse(error.statusCode, { success: false, error: error.message });
      }
      if (decision?.allowed && decision.write) audit('error');
      return internalErrorResponse(500, 'console_rpc_failed', error);
    }
  }, {
    summary: 'Console RPC',
    tags: ['console'],
    description: 'Plugin Runtime Console request envelope: `{ type, data?, requestId? }`.',
  });
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
