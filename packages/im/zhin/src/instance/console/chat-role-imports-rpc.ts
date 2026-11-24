/**
 * ADR 0060 §4: `chat-roles.imports.list|resolve` — the Console side of the configuration import.
 *
 * - Both need a **global** `iam.manage` binding whatever the payload says: an import may grant
 *   `owner`, and the first import reveals who was named in the configuration.
 * - `resolve` `import` applies the first import's rules (a stored role is only raised; `ai.trigger.*`
 *   global grants only on real platform adapters) and is audited as `chat-roles.import`; `ignore`
 *   drops the candidate (audited); `acknowledge` marks the first import as read.
 * - Waiting `ai.personalPrincipals` links (new or changed after the first import, or onto a person
 *   who holds grants) are listed as `personalPending` and resolved with the same `import` / `ignore`.
 * - Without a relational project database `import` is refused (503 `chat-roles-unpersisted`) and
 *   the candidate stays.
 */
import {
  CHAT_ROLES_RPC,
  type ConsoleChatRoleImportsListResult, type ConsoleChatRoleImportsResolveResult,
} from '@zhin.js/console-protocol';
import { ChatRoleStorageUnavailableError, hasGlobalOwner, type InstanceChatRoleService } from '../chat-roles.js';
import type { ChatRoleAudit, ChatRoleImportBook } from '../chat-role-migration.js';
import { personalPrincipalPending, type PersonalPrincipalImportBook } from '../chat-personal-principals.js';
import type { ChatPeople } from '../chat-people.js';
import { FeatureRpcError, type FeatureRpcReply } from './console-feature-rpc.js';

export interface ChatRoleImportsRpcContext {
  readonly imports?: ChatRoleImportBook;
  /** Aliases of the loaded local simulation adapters: an owner grant nobody speaks as there does not count (#1250). */
  readonly simulatedAdapters?: () => readonly string[];
  /** ADR 0060 §4.1 (P3): `ai.personalPrincipals` import record; `acknowledge` marks it read as well. */
  readonly personal?: PersonalPrincipalImportBook;
  /** Applies a confirmed personal link. */
  readonly people?: ChatPeople;
  readonly roles?: InstanceChatRoleService;
  /** Whether the caller holds `iam.manage` globally. Deny by default. */
  readonly authorizeGlobal?: () => boolean | Promise<boolean>;
  readonly actor?: string;
  /** Audits the decisions on `ai.personalPrincipals` links (`ignore`, `import`, `acknowledge`). */
  readonly audit?: ChatRoleAudit;
  readonly publishEvent?: (type: string, data: unknown) => void;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function isChatRoleImportsRpcType(value: unknown): value is typeof CHAT_ROLES_RPC.IMPORTS_LIST | typeof CHAT_ROLES_RPC.IMPORTS_RESOLVE {
  return value === CHAT_ROLES_RPC.IMPORTS_LIST || value === CHAT_ROLES_RPC.IMPORTS_RESOLVE;
}

/** Dispatches `chat-roles.imports.*`; null means the type belongs elsewhere. */
export async function dispatchChatRoleImportsConsoleRpc(message: Record<string, unknown>, context: ChatRoleImportsRpcContext): Promise<FeatureRpcReply | null> {
  const type = message.type;
  if (!isChatRoleImportsRpcType(type)) return null;
  const input = record(message.data) ? message.data : message;
  try {
    let allowed = false;
    try { allowed = context.authorizeGlobal ? await context.authorizeGlobal() === true : false; } catch { allowed = false; }
    if (!allowed) throw new FeatureRpcError(403, '聊天角色导入需要全局 iam.manage 权限');
    const imports = context.imports;
    if (!imports) throw new FeatureRpcError(503, '聊天角色导入记录不可用');
    let data: ConsoleChatRoleImportsListResult | ConsoleChatRoleImportsResolveResult;
    if (type === CHAT_ROLES_RPC.IMPORTS_LIST) {
      const state = await imports.read();
      const personalPending = context.personal ? personalPrincipalPending((await context.personal.read()).entries)
        .map(({ at, ...entry }) => Object.freeze({ ...entry, seenAt: at })) : [];
      data = Object.freeze({
        imported: state.imported,
        ...(state.importedAt ? { importedAt: state.importedAt } : {}),
        ...(state.importedAcknowledgedAt ? { acknowledgedAt: state.importedAcknowledgedAt } : {}),
        pending: state.pending,
        ...(personalPending.length ? { personalPending: Object.freeze(personalPending) } : {}),
        hasGlobalOwner: context.roles ? hasGlobalOwner(context.roles, context.simulatedAdapters?.() ?? []) : false,
      });
    } else {
      const decision = input.decision;
      const actor = context.actor ?? 'console';
      if (decision === 'acknowledge') {
        const status = await imports.acknowledge(actor);
        const personal = context.personal ? await context.personal.acknowledge(actor, context.audit) : 'unchanged';
        data = Object.freeze({ status: status === 'saved' || personal === 'saved' ? 'acknowledged' as const : 'unchanged' as const });
      } else if (decision === 'import' || decision === 'ignore') {
        if (typeof input.id !== 'string' || !/^[0-9a-f]{24}$/u.test(input.id)) throw new FeatureRpcError(400, 'id 必须是导入候选的 id');
        const resolution = await imports.resolve({ id: input.id, decision, actor });
        if (resolution.status === 'not-found' && context.personal && context.people) {
          // ADR 0060 §4.1: a waiting `ai.personalPrincipals` link (no role is granted).
          const personal = await context.personal.resolve({ id: input.id, decision, people: context.people, actor,
            ...(context.audit ? { audit: context.audit } : {}) });
          if (personal.status !== 'not-found') {
            data = Object.freeze(personal.status === 'ignored' ? { status: 'ignored' as const }
              : { status: 'imported' as const, result: personal.status === 'imported' ? 'written' as const : 'skipped' as const,
                ...(personal.status === 'skipped' ? { reason: 'owned-elsewhere' as const } : {}) });
            context.publishEvent?.('chat-principals:updated', {});
            return { status: 200, body: { success: true, data, type, requestId: message.requestId } };
          }
        }
        if (resolution.status === 'not-found') throw new FeatureRpcError(404, '没有这个待确认的导入候选（可能已被处理）');
        data = Object.freeze(resolution.status === 'imported'
          ? { status: 'imported' as const, result: resolution.result, ...(resolution.reason ? { reason: resolution.reason } : {}) }
          : { status: 'ignored' as const });
        if (resolution.status === 'imported') {
          context.publishEvent?.('chat-roles:updated', { level: resolution.grant.level, key: resolution.grant.key });
        }
      } else {
        throw new FeatureRpcError(400, 'decision 只能是 import、ignore 或 acknowledge');
      }
    }
    return { status: 200, body: { success: true, data, type, requestId: message.requestId } };
  } catch (error) {
    if (error instanceof ChatRoleStorageUnavailableError) {
      return { status: 503, body: { success: false, code: error.code, error: error.message, type, requestId: message.requestId } };
    }
    const status = error instanceof FeatureRpcError ? error.status : 500;
    return { status, body: { success: false, error: error instanceof FeatureRpcError ? error.message : '聊天角色导入操作失败', type, requestId: message.requestId } };
  }
}
