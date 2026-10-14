export interface ModelHarnessConfigItem {
  maxIterations?: number;
  /** Consecutive read-only exploration calls before a harness note is injected; 0 disables. */
  explorationBudget?: number;
  /** Append exploration-discipline guidance (plan first, scope to target files) to the system prompt. */
  explorationGuidance?: boolean;
  /** Steps added per progress extension (overrides ai.agent.toolBudget.extendBy). */
  iterationExtension?: number;
  /** Hard step cap per Turn segment (overrides ai.agent.toolBudget.maxTotalIterations). */
  maxTotalIterations?: number;
  /** Provider quirk: extra attempts when the model returns an empty reply. */
  emptyReplyRetries?: number;
  /** Provider quirk: per-request timeout in ms; 0 disables. */
  requestTimeoutMs?: number;
}

export interface ModelHarnessConfig {
  models?: Record<string, ModelHarnessConfigItem>;
  providerPatterns?: Record<string, ModelHarnessConfigItem>;
}

export interface ModelHarnessRow {
  provider?: string;
  modelPattern: RegExp;
  maxIterations?: number;
  explorationBudget?: number;
  explorationGuidance?: boolean;
  /** Steps added per progress extension (overrides ai.agent.toolBudget.extendBy). */
  iterationExtension?: number;
  /** Hard step cap per Turn segment (overrides ai.agent.toolBudget.maxTotalIterations). */
  maxTotalIterations?: number;
  /** Provider quirk: extra attempts when the model returns an empty reply. */
  emptyReplyRetries?: number;
  /** Provider quirk: per-request timeout in ms; 0 disables. */
  requestTimeoutMs?: number;
}

export interface ResolvedModelHarness {
  maxIterations?: number;
  explorationBudget?: number;
  explorationGuidance?: boolean;
  iterationExtension?: number;
  maxTotalIterations?: number;
  /** Provider quirk: extra attempts when the model returns an empty reply. */
  emptyReplyRetries?: number;
  /** Provider quirk: per-request timeout in ms; 0 disables. */
  requestTimeoutMs?: number;
}
