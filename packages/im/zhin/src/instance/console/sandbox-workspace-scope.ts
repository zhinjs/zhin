import { adapterFeatureId, isAdapterIndex, resolveStaticCapabilities } from '@zhin.js/adapter';
import type { RuntimeSnapshot, SnapshotReader } from '@zhin.js/plugin-runtime';
import { jsonResponse, type RouteContext } from '@zhin.js/host-http';
import type { ConversationRef } from '@zhin.js/im-contract';

export interface SandboxWorkspaceScope {
  readonly endpoint: Readonly<{ adapter: string; id: string }>;
  readonly endpointKey: string;
  readonly ownerId: string;
  readonly connectionId: string;
}

export class SandboxWorkspaceBindingError extends Error {
  readonly code = 'sandbox_binding_unavailable';
  constructor() { super('当前 Sandbox 连接归属不可用，请重新连接后再试'); }
}

/** #1250 b114 L1: the connection was opened by another Console principal than the request's. */
export class SandboxWorkspaceForbiddenError extends Error {
  readonly code = 'sandbox_connection_forbidden';
  constructor() { super('该 Sandbox 连接不属于当前登录用户'); }
}

/** The 403 answer for {@link SandboxWorkspaceForbiddenError}, or undefined for any other error. */
export function sandboxScopeForbiddenResponse(error: unknown): Response | undefined {
  return error instanceof SandboxWorkspaceForbiddenError
    ? jsonResponse(403, { success: false, code: error.code, error: error.message }) : undefined;
}

/** Who asks: the connection id and the principal the Host authenticated for this request. */
export interface SandboxWorkspaceRequest {
  readonly connectionId: string;
  readonly principal: RouteContext['principal'];
}

/** Live facts of the bound connection that are not part of the (serialisable) scope. */
export interface SandboxWorkspaceLive {
  /** The chat identity this connection speaks as with 「以我的聊天身份发言」 in `conversation`. */
  chatIdentityOf(conversation: ConversationRef): string | undefined;
}

/**
 * Same encoding as the Sandbox adapter's `sandboxPrincipalOwner` (the adapter package is not a
 * dependency of the instance): `user:<userId>` for a session or API token of one user, `bootstrap`,
 * or null without a principal.
 */
function principalOwner(principal: RouteContext['principal']): string | null {
  if (!principal) return null;
  if (principal.kind === 'bootstrap') return 'bootstrap';
  return principal.userId ? `user:${principal.userId}` : `unknown:${principal.kind}`;
}

/**
 * Uses the live transport's server-owned identity, never an owner supplied by a browser. The
 * connection must belong to the requesting principal (#1250 b114 L1: the same Console user, whether
 * by session or API token); another principal's connection id is refused with
 * {@link SandboxWorkspaceForbiddenError}. A Sandbox client that does not report its owner (an older
 * adapter) is not compared.
 */
export async function withSandboxWorkspaceScope<T>(
  snapshots: SnapshotReader | undefined,
  request: SandboxWorkspaceRequest,
  operation: (scope: SandboxWorkspaceScope, snapshot: RuntimeSnapshot, live: SandboxWorkspaceLive) => Promise<T>,
): Promise<T> {
  const { connectionId } = request;
  if (!snapshots) throw new SandboxWorkspaceBindingError();
  let lease: ReturnType<SnapshotReader['acquire']>;
  try { lease = snapshots.acquire(); }
  catch { throw new SandboxWorkspaceBindingError(); }
  try {
    const index = lease.value.projections.get(adapterFeatureId);
    if (!isAdapterIndex(index)) throw new SandboxWorkspaceBindingError();
    for (const row of index.describe()) {
      // ADR 0044: the Endpoint declares `runtime.sandbox`; no platform name is compared here.
      const profile = index.capabilityProfile(row.id);
      if (!row.admitted || !profile || resolveStaticCapabilities(profile, []).runtime?.sandbox !== true) continue;
      const client = index.clientById<{
        connectionById?: (id: string) => { target: string; owner: string; placeholder: boolean; socket: { readyState: number };
          principalOwner?: string | null } | undefined;
        chatIdentityOf?: (connectionId: string, conversation: ConversationRef) => string | undefined;
      }>(row.id);
      const connection = client.connectionById?.(connectionId);
      if (!connection || connection.placeholder || connection.socket.readyState !== 1) continue;
      if (connection.principalOwner !== undefined && connection.principalOwner !== principalOwner(request.principal)) {
        throw new SandboxWorkspaceForbiddenError();
      }
      const live: SandboxWorkspaceLive = Object.freeze({ chatIdentityOf: (conversation: ConversationRef) => {
        try { return client.chatIdentityOf?.(connectionId, conversation); } catch { return undefined; }
      } });
      return await operation({ endpoint: { adapter: index.clientAdapter(row.id), id: String(row.id) }, endpointKey: connection.target,
        ownerId: connection.owner, connectionId }, lease.value, live);
    }
    throw new SandboxWorkspaceBindingError();
  } finally { lease.release(); }
}

/** The live binding owns the target boundary; colons inside target and scene are not separators. */
export function parseBoundSandboxSession(
  scope: Pick<SandboxWorkspaceScope, 'endpoint' | 'endpointKey'>,
  sessionKey: string,
): { status: 'ready'; kind: 'private' | 'group' | 'channel'; id: string }
  | { status: 'scope_mismatch' }
  | { status: 'invalid' } {
  const prefix = `${scope.endpoint.adapter}:${scope.endpointKey}:`;
  if (!sessionKey.startsWith(prefix)) return { status: 'scope_mismatch' };
  const remainder = sessionKey.slice(prefix.length);
  const separator = remainder.indexOf(':');
  const kind = remainder.slice(0, separator);
  if (separator <= 0 || separator === remainder.length - 1
    || (kind !== 'private' && kind !== 'group' && kind !== 'channel')) return { status: 'invalid' };
  return { status: 'ready', kind, id: remainder.slice(separator + 1) };
}
