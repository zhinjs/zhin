import { SECTION_SEP } from '../config/index.js';

const TRUNCATED_MARK = '\n… (truncated)';

export type PromptRetention = 'required' | 'preferred' | 'opportunistic';

export interface PromptBudgetSection {
  readonly id?: string;
  readonly content: string | null;
  readonly retention: PromptRetention;
  readonly order: number;
  readonly maxChars?: number;
}

/**
 * 系统提示词总量护栏：opportunistic 比 preferred 先让出预算，
 * 同一保留级别内低 order 先让出；required 永不静默截断。
 */
export function enforcePromptBudget(
  sections: readonly PromptBudgetSection[],
  maxChars: number,
): string {
  const present = sections.flatMap((section) => {
    if (!section.content?.trim()) return [];
    let content = section.content;
    if (section.maxChars !== undefined && content.length > section.maxChars) {
      if (section.retention === 'required') {
        throw new Error(`required Prompt Section ${section.id ?? '<anonymous>'} exceeds maxChars ${section.maxChars}`);
      }
      content = truncateTo(content, section.maxChars);
    }
    return [{ ...section, content }];
  });
  const total = () =>
    present.reduce((n, s, i) => n + s.content.length + (i > 0 ? SECTION_SEP.length : 0), 0);
  if (maxChars <= 0 || total() <= maxChars) {
    return present.map(s => s.content).join(SECTION_SEP);
  }
  const candidates = [...present]
    .filter((section) => section.retention !== 'required')
    .sort((left, right) => {
      const retention = retentionRank(left.retention) - retentionRank(right.retention);
      return retention || left.order - right.order;
    });
  for (const candidate of candidates) {
    if (total() <= maxChars) break;
    const index = present.indexOf(candidate);
    if (index < 0) continue;
    const target = candidate.content.length - (total() - maxChars);
    if (target > TRUNCATED_MARK.length) {
      present[index] = { ...candidate, content: truncateTo(candidate.content, target) };
    } else {
      present.splice(index, 1);
    }
  }
  if (total() > maxChars) {
    throw new Error(`required Prompt Sections exceed the ${maxChars} character budget`);
  }
  return present.map(s => s.content).join(SECTION_SEP);
}

function retentionRank(retention: PromptRetention): number {
  return retention === 'opportunistic' ? 0 : retention === 'preferred' ? 1 : 2;
}

function truncateTo(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  if (maxChars <= TRUNCATED_MARK.length) return content.slice(0, maxChars);
  return content.slice(0, maxChars - TRUNCATED_MARK.length) + TRUNCATED_MARK;
}
