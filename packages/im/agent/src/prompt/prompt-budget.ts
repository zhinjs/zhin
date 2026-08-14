import { SECTION_SEP } from '../config/index.js';

const TRUNCATED_MARK = '\n… (truncated)';

/**
 * 系统提示词总量护栏：超预算时按牺牲顺序（数组靠前的可截断段先压缩）
 * 尾部截断，仍超长再整段丢弃；truncatable=false 段不动。
 */
export function enforcePromptBudget(
  sections: { content: string | null; truncatable: boolean }[],
  maxChars: number,
): string {
  const present = sections.filter(
    (s): s is { content: string; truncatable: boolean } => !!s.content && s.content.trim().length > 0,
  );
  const total = () =>
    present.reduce((n, s, i) => n + s.content.length + (i > 0 ? SECTION_SEP.length : 0), 0);
  if (maxChars <= 0 || total() <= maxChars) {
    return present.map(s => s.content).join(SECTION_SEP);
  }
  for (let i = 0; i < present.length && total() > maxChars; i++) {
    const s = present[i];
    if (!s.truncatable) continue;
    const keep = s.content.length - (total() - maxChars) - TRUNCATED_MARK.length;
    if (keep > 0) {
      s.content = s.content.slice(0, keep) + TRUNCATED_MARK;
    } else {
      present.splice(i, 1);
      i--;
    }
  }
  return present.map(s => s.content).join(SECTION_SEP);
}
