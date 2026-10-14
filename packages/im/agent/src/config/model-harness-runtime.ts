import type {
  ModelHarnessConfig,
  ModelHarnessRow,
  ResolvedModelHarness,
} from './model-harness.js';

export const MODEL_HARNESS_DEFAULTS: ModelHarnessRow[] = [
  { provider: 'ollama', modelPattern: /(?:^|[-_:])(0\.5b|1\.5b|3b|7b)(?:$|[-_:])/i, maxIterations: 4 },
  { provider: 'ollama', modelPattern: /(?:qwen|llama|mistral).*(?:14b|32b)/i, maxIterations: 6 },
  { provider: 'openai', modelPattern: /gpt-4(\.|o|$)/i, maxIterations: 7 },
  { provider: 'anthropic', modelPattern: /claude-3|claude-4/i, maxIterations: 7 },
  // MiniMax M-series (direct or routed as `minimax/minimax-m3`): strong tool use but
  // prone to long read-only exploration before acting. Keep the configured
  // iteration budget and steer it with guidance plus an earlier exploration nudge.
  // It also occasionally ends a step with an empty reply; re-ask once before giving up.
  {
    modelPattern: /(?:^|\/)minimax-m\d/i,
    explorationBudget: 5,
    explorationGuidance: true,
    emptyReplyRetries: 1,
  },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  const proto = value && typeof value === 'object'
    ? Object.getPrototypeOf(value)
    : null;
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (proto === Object.prototype || proto === null);
}

export function mergeModelHarnessValues<T>(defaults: T, overrides: unknown): T {
  if (Array.isArray(defaults)) {
    return (Array.isArray(overrides) ? overrides : defaults) as T;
  }
  if (!isPlainObject(defaults)) {
    return (overrides === undefined ? defaults : overrides) as T;
  }
  if (!isPlainObject(overrides)) {
    return defaults;
  }
  const result: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    result[key] = key in result
      ? mergeModelHarnessValues(result[key], value)
      : value;
  }
  return result as T;
}

function providerPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.-]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function sanitizeResolvedHarness(input: Record<string, unknown>): ResolvedModelHarness {
  const resolved: ResolvedModelHarness = {};
  if (typeof input.maxIterations === 'number' && Number.isFinite(input.maxIterations)) {
    resolved.maxIterations = input.maxIterations;
  }
  if (typeof input.explorationBudget === 'number'
    && Number.isFinite(input.explorationBudget)
    && input.explorationBudget >= 0) {
    resolved.explorationBudget = Math.floor(input.explorationBudget);
  }
  if (typeof input.explorationGuidance === 'boolean') {
    resolved.explorationGuidance = input.explorationGuidance;
  }
  for (const key of ['emptyReplyRetries', 'requestTimeoutMs'] as const) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      resolved[key] = Math.floor(value);
    }
  }
  return resolved;
}

function rowHarness(row: ModelHarnessRow): Record<string, unknown> {
  const { provider: _provider, modelPattern: _modelPattern, ...harness } = row;
  return harness;
}

export function resolveModelHarness(
  providerName: string,
  modelName: string,
  config?: ModelHarnessConfig,
): ResolvedModelHarness {
  const defaultHarness: Record<string, unknown> = (() => {
    for (const row of MODEL_HARNESS_DEFAULTS) {
      if (row.provider && row.provider !== providerName) continue;
      if (!row.modelPattern.test(modelName)) continue;
      return rowHarness(row);
    }
    return {};
  })();

  const providerOverride = Object.entries(config?.providerPatterns || {}).reduce<Record<string, unknown>>(
    (acc, [pattern, value]) => providerPatternToRegExp(pattern).test(providerName)
      ? mergeModelHarnessValues(acc, value)
      : acc,
    {},
  );

  const modelOverride = mergeModelHarnessValues(
    config?.models?.[modelName] || {},
    config?.models?.[`${providerName}:${modelName}`] || {},
  );

  const merged = mergeModelHarnessValues(
    mergeModelHarnessValues(defaultHarness, providerOverride),
    modelOverride,
  );
  return sanitizeResolvedHarness(merged as Record<string, unknown>);
}
