/**
 * 安全/策略拒绝检测 — 区分「可重试失败」与「策略硬性拒绝」
 *
 * 策略拒绝时不应换工具/参数反复尝试。
 */

const POLICY_DENIAL_PATTERNS: RegExp[] = [
  /ZHIN_NEEDS_OWNER:/,
  /execSecurity\s*=\s*deny/i,
  /不在允许列表/,
  /不在\s*execAllowlist/i,
  /已被拒绝/,
  /文件访问策略/,
  /策略拒绝/,
  /禁止访问内网/,
  /SSRF\s*防护/,
  /拒绝执行危险命令/,
  /当前配置禁止执行\s*Shell/i,
  /敏感路径/,
  /需\s*Owner\s*确认/,
  /此\s*shell\s*命令需\s*Bot\s*Owner/i,
  /policyBlocked/i,
];

/** 默认：同一轮对话内累计 2 次策略拒绝后强制结束工具循环 */
export const DEFAULT_POLICY_DENIAL_STOP_AFTER = 2;

export function isPolicyDenialMessage(text: string): boolean {
  const s = (text || '').trim();
  if (!s) return false;
  return POLICY_DENIAL_PATTERNS.some((re) => re.test(s));
}

/**
 * 判断工具返回（含 JSON 包装的 executeToolCall 错误）是否为策略拒绝。
 */
export function isPolicyDenialToolResult(result: string): boolean {
  const s = (result || '').trim();
  if (!s) return false;
  if (isPolicyDenialMessage(s)) return true;
  if (s.startsWith('{')) {
    try {
      const parsed = JSON.parse(s) as { error?: string; policyBlocked?: boolean; hint?: string };
      if (parsed.policyBlocked === true) return true;
      if (parsed.error && isPolicyDenialMessage(parsed.error)) return true;
      if (parsed.hint && isPolicyDenialMessage(parsed.hint)) return true;
    } catch {
      /* not json */
    }
  }
  return false;
}
