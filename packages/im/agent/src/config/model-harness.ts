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
}

export interface ResolvedModelHarness {
  maxIterations?: number;
  explorationBudget?: number;
  explorationGuidance?: boolean;
  iterationExtension?: number;
  maxTotalIterations?: number;
}
