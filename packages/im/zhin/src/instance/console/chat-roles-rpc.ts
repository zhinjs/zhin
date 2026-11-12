/**
 * ADR 0056 §3–§4: `chat-roles.list|grant|revoke|mappings|set-mappings` Console RPC (permission
 * `iam.manage`; adapter / endpoint-scoped bindings count for every scope under them, see
 * `featureScopeTarget`).
 */
import {
  CHAT_ROLES_RPC_PERMISSIONS, isConsoleChatRolesRpcType,
  type ConsoleChatRoleEntry, type ConsoleChatRoleMappingLayer, type ConsoleChatRolesRpcType, type ConsoleFeatureLevel,
} from '@zhin.js/console-protocol';
import {
  configChatRoleMappingLayers, mergeChatRoleMappings, DEFAULT_CHAT_ROLE_MAPPINGS,
  type ChatRoleMappingLayer, type ChatRoleSnapshot,
} from '@zhin.js/core';
import { parseFeatureResolutionKey } from '@zhin.js/plugin-runtime';
import {
  chatScopeChain, isChatIdentity, isChatRole, normalizeChatRoleScope,
  type ChatRoleEntry, type ChatRoleMappingStore, type InstanceChatRoleService, type StoredChatRoleMappings,
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
  /** Conversation-level mapping rules. */
  readonly mappings?: ChatRoleMappingStore;
  /** Current runtime snapshot (adapter / account mapping rules from the live configuration). */
  readonly snapshot?: () => ChatRoleSnapshot | undefined;
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

function layerView(layer: ChatRoleMappingLayer, stored?: StoredChatRoleMappings): ConsoleChatRoleMappingLayer {
  return Object.freeze({ level: layer.level, rules: layer.rules, inherit: layer.inherit !== false,
    ...(stored ? { revision: stored.revision, updatedAt: stored.updatedAt, ...(stored.updatedBy ? { updatedBy: stored.updatedBy } : {}) } : {}) });
}

function mappingsView(scope: string, context: ChatRolesRpcContext) {
  const parsed = parseFeatureResolutionKey(scope);
  const layers: ChatRoleMappingLayer[] = [...configChatRoleMappingLayers(context.snapshot?.(), parsed.adapter!, parsed.endpointId)];
  const stored = parsed.conversation ? context.mappings?.get(scope) : undefined;
  const storedLayer = parsed.conversation ? context.mappings?.layer(scope) : undefined;
  if (storedLayer) layers.push(storedLayer);
  return Object.freeze({
    layers: Object.freeze([
      layerView({ level: 'default', rules: DEFAULT_CHAT_ROLE_MAPPINGS }),
      ...layers.map(layer => layerView(layer, layer.level === 'conversation' ? stored : undefined)),
    ]),
    effective: mergeChatRoleMappings(layers),
  });
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
    if (type === 'chat-roles.mappings' || type === 'chat-roles.set-mappings') {
      if (level === 'global') throw new FeatureRpcError(400, '映射规则只在适配器、账号与会话层');
      if (type === 'chat-roles.mappings') {
        data = mappingsView(scope, context);
      } else {
        if (level !== 'conversation') throw new FeatureRpcError(400, '适配器与账号层的映射规则写在配置文件中，Console 只能修改会话层');
        if (!context.mappings) throw new FeatureRpcError(503, '映射规则不可用');
        const expected = input.expectedRevision;
        if (expected !== undefined && (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 0)) {
          throw new FeatureRpcError(400, 'expectedRevision 必须是非负整数');
        }
        try {
          const result = await context.mappings.set({ key: scope, mappings: input.mappings, inherit: input.inherit,
            ...(context.actor ? { updatedBy: context.actor } : {}), ...(expected !== undefined ? { expectedRevision: expected } : {}) });
          const layer = context.mappings.layer(scope);
          data = Object.freeze({ status: result.status, ...(layer ? { layer: layerView(layer, context.mappings.get(scope)) } : {}) });
          if (result.status === 'saved') context.publishEvent?.('chat-roles:updated', { level, key: scope });
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          data = Object.freeze({ status: 'invalid', error: error.message });
        }
      }
    } else if (type === 'chat-roles.list') {
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
