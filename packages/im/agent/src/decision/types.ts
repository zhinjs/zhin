import type { DecisionProvider } from '@zhin.js/ai';
import type { DecisionPurposePolicy } from '@zhin.js/ai/provider';

/** The five decision purposes; the interjection judge left them for `purposes.ambient` (ADR 0066 D1.8). */
export type DecisionTask = 'skills' | 'tools' | 'memory' | 'agents' | 'approval';
export type DecisionMode = 'off' | 'shadow' | 'active';

export type DecisionTaskPolicy = DecisionPurposePolicy;
export type AgentDecisionConfig = Readonly<Partial<Record<DecisionTask, DecisionTaskPolicy>>>;

/** Observations contain no message, candidate name, parameter, or private text. */
export interface DecisionObservation {
  /** `ambient`: a decision model of the interjection judge chain (ADR 0066), not a decision purpose. */
  readonly task: DecisionTask | 'ambient';
  readonly mode: DecisionMode;
  readonly outcome: 'selected' | 'abstained' | 'failed' | 'shadow';
  readonly candidates: number;
  readonly selected: number;
  readonly durationMs: number;
  readonly model?: string;
  readonly reason?: 'provider_error' | 'timeout' | 'low_confidence' | 'no_relevant_candidate' | 'invalid_response';
  readonly usage?: Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }>;
}

export interface AgentDecisionRuntime {
  /** A task's selected Profile is bound to the same operation graph and credentials. */
  forTask(task: DecisionTask): DecisionProvider | undefined;
  readonly config: AgentDecisionConfig;
  readonly observe?: (observation: DecisionObservation) => void;
}
