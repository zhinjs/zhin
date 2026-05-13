export interface ModelHarnessRow {
  provider?: string;
  modelPattern: RegExp;
  maxIterations?: number;
}

export interface ResolvedModelHarness {
  maxIterations?: number;
}

export const MODEL_HARNESS_DEFAULTS: ModelHarnessRow[] = [
  { provider: 'ollama', modelPattern: /(?:^|[-_:])(0\.5b|1\.5b|3b|7b)(?:$|[-_:])/i, maxIterations: 4 },
  { provider: 'ollama', modelPattern: /(?:qwen|llama|mistral).*(?:14b|32b)/i, maxIterations: 6 },
  { provider: 'openai', modelPattern: /gpt-4(\.|o|$)/i, maxIterations: 7 },
  { provider: 'anthropic', modelPattern: /claude-3|claude-4/i, maxIterations: 7 },
];

export function resolveModelHarness(providerName: string, modelName: string): ResolvedModelHarness {
  for (const row of MODEL_HARNESS_DEFAULTS) {
    if (row.provider && row.provider !== providerName) continue;
    if (!row.modelPattern.test(modelName)) continue;
    return { maxIterations: row.maxIterations };
  }
  return {};
}
