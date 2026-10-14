/**
 * SenderRole — 框架层发送者角色（user / master / trusted）
 * 平台群/频道身份见 platform(adapter,perm) 与适配器 checker
 */
export type SenderRole = 'user' | 'trusted' | 'master';

const FRAMEWORK_SENDER_ROLES = new Set<SenderRole>(['user', 'trusted', 'master']);

export function isFrameworkSenderRole(role: string): role is SenderRole {
  return FRAMEWORK_SENDER_ROLES.has(role as SenderRole);
}

/** 匹配工具要求时的隐含升格（不写入持久化 roles 集合） */
const ROLE_IMPLIES: Partial<Record<SenderRole, readonly SenderRole[]>> = {
  master: ['trusted'],
};

export function expandImpliedRoles(roles: Iterable<SenderRole>): Set<SenderRole> {
  const out = new Set<SenderRole>(roles);
  for (const role of [...out]) {
    for (const implied of ROLE_IMPLIES[role] ?? []) {
      out.add(implied);
    }
  }
  return out;
}

export function roleSatisfies(
  callerRoles: Iterable<SenderRole>,
  requiredAnyRole: readonly SenderRole[] | undefined,
): boolean {
  if (!requiredAnyRole?.length) return true;
  const expanded = expandImpliedRoles(callerRoles);
  return requiredAnyRole.some((req) => expanded.has(req));
}

/** 去重；无其它角色时返回 ['user'] */
export function normalizeSenderRoles(roles: Iterable<SenderRole>): SenderRole[] {
  const set = new Set<SenderRole>();
  for (const r of roles) {
    if (r !== 'user') set.add(r);
  }
  if (set.size === 0) return ['user'];
  return [...set];
}

export function hasSenderRole(roles: Iterable<SenderRole>, role: SenderRole): boolean {
  return expandImpliedRoles(roles).has(role);
}

export function formatSenderRolesForLabel(roles: readonly SenderRole[]): string {
  return roles.filter((r) => r !== 'user').join(',') || 'user';
}

// 空白与零宽字符（不含 U+200D：会破坏 emoji ZWJ 序列）。
const SPOOF_GAP = '[\\s\\u200B\\u200C\\u2060\\uFEFF]';
const spoofWord = (word: string): string => word.split('').join(`${SPOOF_GAP}*`);
const SPOOFED_LABEL_RE = new RegExp(
  `\\[(?=${SPOOF_GAP}*(?:${spoofWord('sender')}|${spoofWord('origin')})${SPOOF_GAP}*[:：])`,
  'gi',
);

/**
 * 转义用户正文里所有自造的 `[sender:` / `[origin:` 标签（任意位置、大小写不敏感，
 * 容忍 `[ sender :`、零宽字符、全角冒号）。命中时把开头的 ASCII `[` 换成全角 `［`，
 * 其余原样保留：模型仍能看出这是用户文本，但它不再是权威标签。
 * 幂等（已转义文本再次调用不变），不再剥离开头，也不 trim 原文空白。
 */
export function stripUserSpoofedSenderPrefix(rawContent: string): string {
  return rawContent.replace(SPOOFED_LABEL_RE, '\uFF3B');
}
