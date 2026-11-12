/**
 * ADR 0056 §3: `chat-roles.list|grant|revoke` Console RPC (permission `iam.manage`; adapter /
 * endpoint-scoped bindings count for every scope under them, see `featureScopeTarget`).
 */
import {
  CHAT_ROLES_RPC_PERMISSIONS, isConsoleChatRolesRpcType,
  type ConsoleChatRoleEntry, type ConsoleChatRolesRpcType, type ConsoleFeatureLevel,
} from '@zhin.js/console-protocol';
import {
  chatScopeChain, isChatIdentity, isChatRole, normalizeChatRoleScope, type ChatRoleEntry, type ChatRoleService,
} from '../chat-roles.js';
import { FeatureRpcError, readScope, type FeatureRpcReply } from './console-feature-rpc.js';

export interface ChatRolesRpcAuthorization {
  readonly type: ConsoleChatRolesRpcType;
  readonly permission: 'iam.manage';
  readonly level: ConsoleFeatureLevel;
  readonly key?: string;
}

export interface ChatRolesRpcContext {
  readonly roles?: ChatRoleService;
  /** Deny by default: without it every call is refused. */
  readonly authorize?: (request: ChatRolesRpcAuthorization) => boolean | Promise<boolean>;
  readonly actor?: string;
  readonly publishEvent?: (type: string, data: unknown) => void;
}

type Record_ = Record<string, unknown>;
const record = (value: unknown): value is Record_ => !!value && typeof value === 'object' && !Array.isArray(value);

export function chatRoleView(entry: ChatRoleEntry): ConsoleChatRoleEntry {
  return Object.freeze({ level: entry.level, key: entry.key, adapter: entry.adapter, userId: entry.userId, role: entry.role, source: entry.source,
    ...(entry.grantedBy ? { grantedBy: entry.grantedBy } : {}), ...(entry.grantedAt ? { grantedAt: entry.grantedAt } : {}),
    ...(entry.detail ? { detail: entry.detail } : {}) });
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
    let allowed = false;
    try {
      allowed = context.authorize ? await context.authorize({ type, permission: CHAT_ROLES_RPC_PERMISSIONS[type], level, ...(scope ? { key: scope } : {}) }) === true : false;
    } catch { allowed = false; }
    if (!allowed) throw new FeatureRpcError(403, '没有 iam.manage 权限');
    const roles = context.roles;
    if (!roles) throw new FeatureRpcError(503, '聊天角色不可用');
    let data: unknown;
    if (type === 'chat-roles.list') {
      data = Object.freeze({ roles: Object.freeze(roles.list(scope, input.descendants === true).map(chatRoleView)) });
    } else {
      const identity = readIdentity(input, scope);
      if (type === 'chat-roles.grant') {
        if (!isChatRole(input.role)) throw new FeatureRpcError(400, 'role 只能是 owner、admin 或 trusted');
        const status = await roles.store.grant({ level, key: scope, ...identity, role: input.role, ...(context.actor ? { grantedBy: context.actor } : {}) });
        data = Object.freeze({ status, entry: chatRoleView(roles.store.get(level, scope, identity)!) });
      } else {
        const before = roles.store.get(level, scope, identity);
        const status = await roles.store.revoke({ level, key: scope, ...identity });
        data = Object.freeze({ status, ...(before ? { entry: chatRoleView(before) } : {}) });
      }
      context.publishEvent?.('chat-roles:updated', { level, key: scope });
    }
    return { status: 200, body: { success: true, data, type, requestId: message.requestId } };
  } catch (error) {
    const status = error instanceof FeatureRpcError ? error.status : 500;
    return { status, body: { success: false, error: error instanceof FeatureRpcError ? error.message : '聊天角色操作失败', type, requestId: message.requestId } };
  }
}
