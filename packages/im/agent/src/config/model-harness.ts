export interface ModelHarnessConfigItem {
  maxIterations?: number;
}

export interface ModelHarnessConfig {
  models?: Record<string, ModelHarnessConfigItem>;
  providerPatterns?: Record<string, ModelHarnessConfigItem>;
}

export interface ModelHarnessRow {
  provider?: string;
  modelPattern: RegExp;
  maxIterations?: number;
}

export interface ResolvedModelHarness {
  maxIterations?: number;
}
