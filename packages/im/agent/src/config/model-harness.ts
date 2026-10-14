export interface ModelHarnessConfigItem {
  maxIterations?: number;
  /** Consecutive read-only exploration calls before a harness note is injected; 0 disables. */
  explorationBudget?: number;
  /** Append exploration-discipline guidance (plan first, scope to target files) to the system prompt. */
  explorationGuidance?: boolean;
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
}

export interface ResolvedModelHarness {
  maxIterations?: number;
  explorationBudget?: number;
  explorationGuidance?: boolean;
}
