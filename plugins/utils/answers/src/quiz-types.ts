export type QuizLetter = 'A' | 'B' | 'C' | 'D';

export interface QuizQuestion {
  /** 题库内唯一、稳定的题号，用于测试与去重。 */
  readonly id: string;
  readonly category: string;
  readonly question: string;
  /** 2–4 个选项，按 A/B/C/D 顺序排列，不含字母前缀。 */
  readonly options: readonly string[];
  readonly answer: QuizLetter;
  /** 作答后展示的解析。 */
  readonly explanation: string;
}

export const QUIZ_LETTERS: readonly QuizLetter[] = ['A', 'B', 'C', 'D'];
