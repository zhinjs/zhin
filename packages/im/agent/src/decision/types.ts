import type { DecisionProvider } from '@zhin.js/ai';
import type { DecisionPurposePolicy } from '@zhin.js/ai/provider';

export type DecisionTask = 'skills' | 'tools' | 'memory' | 'agents' | 'approval' | 'ambient';
export type DecisionMode = 'off' | 'shadow' | 'active';

export type DecisionTaskPolicy = DecisionPurposePolicy;
export type AgentDecisionConfig = Readonly<Partial<Record<DecisionTask, DecisionTaskPolicy>>>;

/** Observations contain no message, candidate name, parameter, or private text. */
export interface DecisionObservation {
  readonly task: DecisionTask;
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
