import { operationClientAdapter } from '@zhin.js/feature-kit';
import { explainPermitRules, toPermissionSubject, type PermissionSubject, type PermissionConditionExplanation } from '@zhin.js/permission';
import { resolveCommandSender, resolveCommandSession, type CommandMessage } from './definition.js';
import type { CommandDescriptor } from './command-index.js';

/** The exact subject projection used by the real command permit gate. No factories or checkers run. */
export function toCommandPermissionSubject(source: unknown): PermissionSubject {
  const projected = toPermissionSubject(source);
  const session = resolveCommandSession(source);
  return { ...projected, ...session, ...(session.sender ? { sender: { ...projected.sender, ...session.sender } } : {}) };
}

/** Exact authoring adapter restriction, distinct from builtin adapter(...) matching. */
export function commandAdapterMatches(command: Readonly<{ adapter?: string }>, source: unknown): boolean {
  return !command.adapter || operationClientAdapter(source) === command.adapter;
}

export type CommandPermissionHostStatus = 'present' | 'missing' | 'unverified';

/** Read-only hypothetical conditions. A match is not permission to execute the command. */
export function explainCommandPermissions(
  command: Pick<CommandDescriptor, 'adapter' | 'permit'>,
  options: Readonly<{ source?: unknown; rolesKnown?: boolean; permissionHost: CommandPermissionHostStatus }>,
) {
  const projected = toCommandPermissionSubject(options.source);
  const inputSender = options.source && typeof options.source === 'object'
    ? (options.source as Pick<CommandMessage, 'sender'>).sender : undefined;
  const structuredRoles = inputSender && typeof inputSender === 'object'
    && Array.isArray((inputSender as { readonly role?: unknown }).role);
  // A sender-only assumption has no synthetic conversation. Apply the real canonical
  // sender defaults without inventing an Endpoint or treating unknown roles as known.
  const senderOnly = options.source && typeof options.source === 'object' && !('conversation' in options.source) && !structuredRoles
    ? resolveCommandSender(options.source as Pick<CommandMessage, 'sender'>, undefined) : undefined;
  const subject = senderOnly ? { ...projected, sender: senderOnly } : projected;
  const defaultedRoles = options.rolesKnown && Array.isArray(inputSender?.roles) && inputSender.roles.length === 0
    && subject.sender?.role.length === 1 && subject.sender.role[0] === 'user';
  const actualAdapter = operationClientAdapter(options.source);
  const adapter: PermissionConditionExplanation = !command.adapter
    ? { outcome: 'not_evaluated', reason: '命令未声明 adapter 约束' }
    : !actualAdapter ? { outcome: 'unknown', reason: '未选择当前 Endpoint，无法判断命令的精确 adapter 约束' }
      : { outcome: commandAdapterMatches(command, options.source) ? 'match' : 'mismatch', reason: '命令 adapter 与当前 Endpoint 声明的原生适配器精确比较；未探测在线状态' };
  const rules = explainPermitRules(command.permit ?? [], subject, { rolesKnown: options.rolesKnown });
  const conditions = [...(command.adapter ? [adapter] : []), ...rules];
  let summary: PermissionConditionExplanation;
  if (conditions.some(item => item.outcome === 'mismatch')) summary = { outcome: 'mismatch', reason: '至少一个声明条件与假设输入不符；这不是实际准入检查' };
  else if ((rules.length > 0 && options.permissionHost !== 'present') || conditions.some(item => item.outcome === 'unknown')) {
    summary = { outcome: 'unknown', reason: rules.length > 0 && options.permissionHost !== 'present'
      ? 'PermissionHost 缺失或无法确认；不能推断命令可执行' : '存在缺少依据的条件，不能推断命令可执行' };
  } else if (rules.length === 0) summary = { outcome: 'not_evaluated', reason: '命令未声明 permit 限制；这不表示已获得执行权限' };
  else if (conditions.some(item => item.outcome === 'not_evaluated')) summary = { outcome: 'not_evaluated', reason: '存在未执行的平台或自定义条件，不能推断命令可执行' };
  else summary = { outcome: 'match', reason: '已解释的 builtin 条件与假设输入匹配；不代表真实授权或命令可执行' };
  return Object.freeze({ permissionHost: options.permissionHost, adapter: Object.freeze(adapter), rules, summary: Object.freeze(summary),
    unconstrained: Object.freeze(['已解释的 builtin 规则不检查具体 Endpoint、parent 或 thread；保留完整目标不等于这些维度受规则限制']),
    assumptions: Object.freeze(['身份与角色仅用于模拟，未向平台核实', '未执行命令、动态默认值、平台或自定义 checker',
      ...(defaultedRoles
        ? ['canonical 输入未附角色时按命令运行时默认 user 解释；这不是已核验的平台角色'] : [])]),
  });
}
