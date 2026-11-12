/**
 * ADR 0056 §3: `chat-roles.list|grant|revoke` Console RPC (permission `iam.manage`; adapter /
 * endpoint-scoped bindings count for every scope under them, see `featureScopeTarget`).
 *
 * - Granting or revoking `owner` — or replacing / removing an existing `owner` grant — needs
 *   **global** `iam.manage`, whatever the target level: an owner role reaches host-wide
 *   capabilities, so an account bound to one adapter / endpoint cannot hand it out (not even to
 *   itself in a conversation).
 * - `admin` / `trusted` need `iam.manage` covering the target scope.
 * - `list` shows identities only for entries at scopes the caller manages; entries inherited from
 *   above (e.g. global owners, seen from an endpoint-scoped caller) show role and level only
 *   (`redacted: true`).
 * - Without a relational project database grants are refused (503 `chat-roles-unpersisted`).
 */
import {
  CHAT_ROLES_RPC_PERMISSIONS, isConsoleChatRolesRpcType,
  type ConsoleChatRoleEntry, type ConsoleChatRolesRpcType, type ConsoleFeatureLevel,
} from '@zhin.js/console-protocol';
import {
  ChatRoleStorageUnavailableError, chatScopeChain, chatRoleIncludes, isChatIdentity, isChatRole, normalizeChatRoleScope,
  type ChatRole, type ChatRoleEntry, type InstanceChatRoleService,
} from '../chat-roles.js';
import { FeatureRpcError, readScope, type FeatureRpcReply } from './console-feature-rpc.js';

export interface ChatRolesRpcAuthorization {
  readonly type: ConsoleChatRolesRpcType;
  readonly permission: 'iam.manage';
  readonly level: ConsoleFeatureLevel;
  readonly key?: string;
}

export interface ChatRolesRpcContext {
  readonly roles?: InstanceChatRoleService;
  /** Deny by default: without it every call is refused. */
  readonly authorize?: (request: ChatRolesRpcAuthorization) => boolean | Promise<boolean>;
  readonly actor?: string;
  readonly publishEvent?: (type: string, data: unknown) => void;
}

type Record_ = Record<string, unknown>;
const record = (value: unknown): value is Record_ => !!value && typeof value === 'object' && !Array.isArray(value);

/** An entry outside the caller's scope: role and level only. */
function redactedView(entry: ChatRoleEntry): ConsoleChatRoleEntry {
  return Object.freeze({ level: entry.level, key: entry.key, role: entry.role, source: entry.source, redacted: true as const });
}

export function chatRoleView(entry: ChatRoleEntry): ConsoleChatRoleEntry {
  return Object.freeze({ level: entry.level, key: entry.key, adapter: entry.adapter, userId: entry.userId, role: entry.role, source: entry.source,
    ...(entry.grantedBy ? { grantedBy: entry.grantedBy } : {}), ...(entry.grantedAt ? { grantedAt: entry.grantedAt } : {}) });
}

function readIdentity(input: Record_, scope: string): { adapter: string; userId: string } {
  const identity = { adapter: input.adapter, userId: input.userId };
  if (!isChatIdentity(identity)) throw new FeatureRpcError(400, 'adapter 必须是适配器实例别名，userId 必须是平台用户 id');
  const alias = chatScopeChain(scope)[1];
  // Below global, a role belongs to an identity on the scope's own adapter.
  if (alias !== undefined && identity.adapter !== alias) throw new FeatureRpcError(400, `该层级的角色必须授予适配器 ${alias} 上的用户`);
  return identity as { adapter: string; userId: string };
}

/** Dispatches `chat-roles.*`; null means the type belongs elsewhere. */
export async function dispatchChatRolesConsoleRpc(message: Record_, context: ChatRolesRpcContext): Promise<FeatureRpcReply | null> {
  const type = message.type;
  if (!isConsoleChatRolesRpcType(type)) return null;
  const input = record(message.data) ? message.data : message;
  try {
    const { level, key } = readScope(input);
    let scope: string;
    try { scope = normalizeChatRoleScope(level, key ?? ''); } catch (error) { throw new FeatureRpcError(400, (error as Error).message); }
    const permission = CHAT_ROLES_RPC_PERMISSIONS[type];
    const authorized = async (request: Omit<ChatRolesRpcAuthorization, 'type' | 'permission'>): Promise<boolean> => {
      try {
        return context.authorize ? await context.authorize({ type, permission, ...request }) === true : false;
      } catch { return false; }
    };
    if (!(await authorized({ level, ...(scope ? { key: scope } : {}) }))) throw new FeatureRpcError(403, '没有 iam.manage 权限');
    const roles = context.roles;
    if (!roles) throw new FeatureRpcError(503, '聊天角色不可用');
    let data: unknown;
    if (type === 'chat-roles.list') {
      const entries = roles.list(scope, input.descendants === true);
      const views = await Promise.all(entries.map(async entry =>
        await authorized({ level: entry.level, ...(entry.key ? { key: entry.key } : {}) }) ? chatRoleView(entry) : redactedView(entry)));
      data = Object.freeze({ roles: Object.freeze(views) });
    } else {
      const identity = readIdentity(input, scope);
      const granting = type === 'chat-roles.grant' ? input.role : undefined;
      if (type === 'chat-roles.grant' && !isChatRole(granting)) throw new FeatureRpcError(400, 'role 只能是 owner、admin 或 trusted');
      const before = roles.store.get(level, scope, identity);
      // The owner role is host-wide: granting it, or replacing / removing an owner grant, needs global iam.manage.
      const touchesOwner = [granting as ChatRole | undefined, before?.role].some(role => role !== undefined && chatRoleIncludes(role, 'owner'));
      if (touchesOwner && !(await authorized({ level: 'global' }))) {
        throw new FeatureRpcError(403, '授予或撤销 owner 需要全局 iam.manage 权限');
      }
      if (!roles.store.persistent) throw new ChatRoleStorageUnavailableError();
      if (type === 'chat-roles.grant') {
        const status = await roles.store.grant({ level, key: scope, ...identity, role: granting as ChatRole, ...(context.actor ? { grantedBy: context.actor } : {}) });
        data = Object.freeze({ status, entry: chatRoleView(roles.store.get(level, scope, identity)!) });
      } else {
        const status = await roles.store.revoke({ level, key: scope, ...identity });
        data = Object.freeze({ status, ...(before ? { entry: chatRoleView(before) } : {}) });
      }
      context.publishEvent?.('chat-roles:updated', { level, key: scope });
    }
    return { status: 200, body: { success: true, data, type, requestId: message.requestId } };
  } catch (error) {
    if (error instanceof ChatRoleStorageUnavailableError) {
      return { status: 503, body: { success: false, code: error.code, error: error.message, type, requestId: message.requestId } };
    }
    const status = error instanceof FeatureRpcError ? error.status : 500;
    return { status, body: { success: false, error: error instanceof FeatureRpcError ? error.message : '聊天角色操作失败', type, requestId: message.requestId } };
  }
}
