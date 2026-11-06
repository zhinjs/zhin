import type { DecisionQuestions, JsonValue } from '../decision/types.js';
import type { GenerateImageInput, LanguageRequest } from './types.js';

/** Semantic input only. Account identity and quota subjects are supplied privately by Host. */
export type InferenceUsageRequest =
  | Readonly<{ kind: 'language'; request: LanguageRequest }>
  | Readonly<{ kind: 'decision'; state: JsonValue; questions: DecisionQuestions }>
  | Readonly<{ kind: 'image'; request: GenerateImageInput['request'] }>;
export interface InferenceUsageOutcome {
  /** Absent means unknown; zero is a reported zero, never an implicit estimate. */
  readonly totalTokens?: number;
  readonly text?: string;
}
export interface InferenceUsageInvocation {
  /** Preserve this call's private attribution through actual asynchronous transport work. */
  run<T>(execute: () => Promise<T>): Promise<T>;
  finish(outcome: InferenceUsageOutcome): void;
  close(): void;
}
export interface InferenceUsageAccounting {
  /** Admission may deny. Merely constructing a lazy client/run never calls this. */
  begin(input: InferenceUsageRequest): InferenceUsageInvocation;
  /** Called immediately before the actual inference transport submits, not for OAuth or catalogues. */
  submitted(): void;
}
