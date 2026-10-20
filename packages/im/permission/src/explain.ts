import { checkBuiltinPermit, isPlatformPermit, parsePermitName, parsePlatformPermitName, type PermitKind } from './builtin.js';
import type { PermissionSubject } from './subject.js';

/** A simulation of declared conditions, never an authorization decision. */
export type PermissionExplanationOutcome = 'match' | 'mismatch' | 'unknown' | 'not_evaluated';
export interface PermissionConditionExplanation {
  readonly outcome: PermissionExplanationOutcome;
  readonly reason: string;
}
export interface PermitRuleExplanation extends PermissionConditionExplanation {
  readonly index: number;
  readonly rule: string;
  readonly kind: PermitKind | 'platform' | 'unknown';
  readonly values?: readonly string[];
}

/** Pure builtin interpretation. Does not resolve or execute any registered checker. */
export function explainPermitRules(
  permits: readonly string[],
  subject: PermissionSubject = {},
  options: Readonly<{ rolesKnown?: boolean }> = {},
): readonly PermitRuleExplanation[] {
  return Object.freeze(permits.map((rule, index): PermitRuleExplanation => {
    const parsed = parsePermitName(rule);
    if (!parsed) {
      if (isPlatformPermit(rule)) return Object.freeze({ index, rule, kind: 'platform',
        outcome: parsePlatformPermitName(rule) ? 'not_evaluated' : 'mismatch',
        reason: parsePlatformPermitName(rule) ? '平台权限 checker 未执行，不能据此判断权限' : '平台权限规则缺少有效的适配器或权限名称' });
      return Object.freeze({ index, rule, kind: 'unknown', outcome: 'not_evaluated', reason: '未知或自定义规则未执行；命令声明仅支持 builtin 与 platform DSL' });
    }
    const { kind, values } = parsed;
    const known = kind === 'adapter' ? !!subject.adapter
      : kind === 'user' ? !!subject.sender?.id
      : kind === 'role' ? !!subject.sender?.id && options.rolesKnown === true
      : !!subject.scene;
    const meanings: Record<PermitKind, string> = {
      adapter: '按完整 adapter、路径末段或末段以“值-”开头匹配；星号不表示任意适配器',
      group: '要求群聊，按群 ID 匹配；空值或星号不限群 ID',
      private: '要求私聊，按会话 ID 匹配；空值或星号不限会话 ID',
      channel: '要求频道，按频道 ID 匹配；空值或星号不限频道 ID',
      user: '按发送者 ID 精确匹配',
      role: '按角色精确匹配；仅 master 隐含 trusted，不隐含 admin',
    };
    const missing = kind === 'role' ? '未提供假设角色，无法判断角色条件'
      : kind === 'user' ? '未提供假设发送者，无法判断用户条件'
      : '未提供会话目标，无法判断此条件';
    return Object.freeze({ index, rule, kind, values: Object.freeze([...values]),
      outcome: known ? (checkBuiltinPermit(rule, subject) ? 'match' : 'mismatch') : 'unknown',
      reason: `${known ? meanings[kind] : missing}；单项内多个值为 OR，规则之间为 AND` });
  }));
}
