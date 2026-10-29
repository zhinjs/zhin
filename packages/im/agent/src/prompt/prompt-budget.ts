import { SECTION_SEP } from '../config/index.js';

const TRUNCATED_MARK = '\n… (truncated)';

export type PromptRetention = 'required' | 'preferred' | 'opportunistic';

export interface PromptBudgetSection {
  readonly id?: string;
  readonly content: string | null;
  readonly retention: PromptRetention;
  readonly order: number;
  /** Defaults to render order; lower values yield budget first. */
  readonly budgetOrder?: number;
  readonly maxChars?: number;
}

/** Per-section outcome of {@link enforcePromptBudgetDetailed}, in the input order. */
export interface PromptBudgetOutcome {
  readonly id?: string;
  /** Final text; empty when the section was absent or dropped. */
  readonly content: string;
  /** Shortened by `maxChars` or the total budget, or dropped entirely. */
  readonly trimmed: boolean;
  readonly dropped: boolean;
}

export interface PromptBudgetResult {
  readonly text: string;
  readonly outcomes: readonly PromptBudgetOutcome[];
}

/**
 * 系统提示词总量护栏：opportunistic 比 preferred 先让出预算，
 * 同一保留级别内低 budgetOrder（缺省 order）先让出；required 永不静默截断。
 */
export function enforcePromptBudget(
  sections: readonly PromptBudgetSection[],
  maxChars: number,
): string {
  return enforcePromptBudgetDetailed(sections, maxChars).text;
}

/** Same budget rules, but also reports what happened to each input section. */
export function enforcePromptBudgetDetailed(
  sections: readonly PromptBudgetSection[],
  maxChars: number,
): PromptBudgetResult {
  type Present = PromptBudgetSection & { content: string; index: number; trimmed: boolean };
  const present: Present[] = sections.flatMap((section, index) => {
    if (!section.content?.trim()) return [];
    let content = section.content;
    let trimmed = false;
    if (section.maxChars !== undefined && content.length > section.maxChars) {
      if (section.retention === 'required') {
        throw new Error(`required Prompt Section ${section.id ?? '<anonymous>'} exceeds maxChars ${section.maxChars}`);
      }
      content = truncateTo(content, section.maxChars);
      trimmed = true;
    }
    return [{ ...section, content, index, trimmed }];
  });
  const total = () =>
    present.reduce((n, s, i) => n + s.content.length + (i > 0 ? SECTION_SEP.length : 0), 0);
  const finish = (): PromptBudgetResult => {
    const kept = new Map(present.map(item => [item.index, item] as const));
    return {
      text: present.map(s => s.content).join(SECTION_SEP),
      outcomes: sections.map((section, index) => {
        const item = kept.get(index);
        return Object.freeze({
          id: section.id,
          content: item?.content ?? '',
          trimmed: item ? item.trimmed : Boolean(section.content?.trim()),
          dropped: !item && Boolean(section.content?.trim()),
        });
      }),
    };
  };
  if (maxChars <= 0 || total() <= maxChars) return finish();
  const candidates = [...present]
    .filter((section) => section.retention !== 'required')
    .sort((left, right) => {
      const retention = retentionRank(left.retention) - retentionRank(right.retention);
      const budget = (left.budgetOrder ?? left.order) - (right.budgetOrder ?? right.order);
      // A section split into a stable head and a later tail still truncates the tail first.
      return retention || budget || left.order - right.order;
    });
  for (const candidate of candidates) {
    if (total() <= maxChars) break;
    const index = present.indexOf(candidate);
    if (index < 0) continue;
    const target = candidate.content.length - (total() - maxChars);
    if (target > TRUNCATED_MARK.length) {
      present[index] = { ...candidate, content: truncateTo(candidate.content, target), trimmed: true };
    } else {
      present.splice(index, 1);
    }
  }
  if (total() > maxChars) {
    throw new Error(`required Prompt Sections exceed the ${maxChars} character budget`);
  }
  return finish();
}

function retentionRank(retention: PromptRetention): number {
  return retention === 'opportunistic' ? 0 : retention === 'preferred' ? 1 : 2;
}

function truncateTo(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  if (maxChars <= TRUNCATED_MARK.length) return content.slice(0, maxChars);
  return content.slice(0, maxChars - TRUNCATED_MARK.length) + TRUNCATED_MARK;
}
