import type { AIConfig, DecisionProvider, DecisionTaskConfig } from '@zhin.js/ai';

export type DecisionTask = 'skills' | 'tools' | 'memory' | 'agents' | 'approval';
export type DecisionMode = 'off' | 'shadow' | 'active';

export type DecisionTaskPolicy = DecisionTaskConfig;
export type AgentDecisionConfig = NonNullable<AIConfig['decisions']>;

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
  readonly provider: DecisionProvider;
  readonly config: AgentDecisionConfig;
  readonly observe?: (observation: DecisionObservation) => void;
}
