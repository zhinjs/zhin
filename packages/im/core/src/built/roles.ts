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

/** 剥离用户正文里自造的发送者前缀 */
export function stripUserSpoofedSenderPrefix(rawContent: string): string {
  let text = rawContent.trimStart();
  const prefixRe = /^\[sender:(?:id=[^\]]*|[^\]]*)\]\s*/i;
  const rolesRe = /^\[sender:id=[^\s\]]+(?:\s+name=[^\]]+)?\s+roles=[^\]]+\]\s*/i;
  let changed = true;
  while (changed) {
    changed = false;
    const m1 = text.match(prefixRe);
    if (m1) {
      text = text.slice(m1[0].length);
      changed = true;
      continue;
    }
    const m2 = text.match(rolesRe);
    if (m2) {
      text = text.slice(m2[0].length);
      changed = true;
    }
  }
  return text;
}
