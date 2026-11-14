/**
 * #1250 tool-capability-unverified (part ②): a reply that claims a lookup
 * ("查了一下", "根据最新", "I checked", …) in a turn that made no tool call
 * is very likely made up. This only flags the turn in its trace and decision
 * replay; nothing changes for the user.
 *
 * The phrase list lives here only (zh + en). Keep entries specific enough
 * that ordinary replies do not match.
 */
export const LOOKUP_CLAIM_PATTERNS: readonly RegExp[] = Object.freeze([
  // zh: 查 / 搜 / 检索 + 完成体; 检查了 / 调查过 / 审查了 are not lookups.
  /(?<![检调审排核抽普复巡盘考侦督])(?:查询|搜索|检索|查|搜)(?:了一?下|了|过|到了?)/u,
  /根据(?:最新|实时|目前|当前)(?:的)?(?:数据|信息|资料|消息|结果|报道|情况|查询|搜索)?/u,
  /(?:最新|实时)(?:数据|信息|资料|消息|结果)(?:显示|表明)/u,
  /(?:看了一?下|翻了一?下)(?:最新|实时)/u,
  // en
  /\bI(?:'ve| have)? (?:just )?(?:checked|looked (?:it )?up|searched|queried|fetched|browsed)\b/iu,
  /\b(?:according to|based on) (?:the )?(?:latest|current|real-time|live|up-to-date) (?:data|info(?:rmation)?|results?|reports?|figures|forecast)\b/iu,
  /\b(?:after|from) (?:a )?(?:quick )?(?:search|lookup|checking)\b/iu,
  /\bthe latest (?:data|figures|reports?) (?:show|shows|indicate|indicates)\b/iu,
]);

/** The first lookup claim in `text`, if any. */
export function findLookupClaim(text: string): string | undefined {
  for (const pattern of LOOKUP_CLAIM_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return undefined;
}

/** A lookup claimed by a turn that made zero tool calls; `undefined` otherwise. */
export function claimWithoutToolCall(reply: string, toolCalls: number): string | undefined {
  if (toolCalls > 0 || !reply.trim()) return undefined;
  return findLookupClaim(reply);
}
