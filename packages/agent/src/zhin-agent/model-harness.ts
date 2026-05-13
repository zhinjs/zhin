export interface ModelHarnessRow {
  provider?: string;
  modelPattern: RegExp;
  maxIterations?: number;
}

export interface ResolvedModelHarness {
  maxIterations?: number;
}

export interface ModelHarnessConfigItem {
  maxIterations?: number;
}

export interface ModelHarnessConfig {
  /**
   * 模型级覆盖：
   * - "gpt-4o"
   * - "openai:gpt-4o"（provider + model 精确覆盖）
   */
  models?: Record<string, ModelHarnessConfigItem>;
  /**
   * provider 模式覆盖（支持 * 通配符）
   * - "openai"
   * - "open*"
   */
  providerPatterns?: Record<string, ModelHarnessConfigItem>;
}

export const MODEL_HARNESS_DEFAULTS: ModelHarnessRow[] = [
  { provider: 'ollama', modelPattern: /(?:^|[-_:])(0\.5b|1\.5b|3b|7b)(?:$|[-_:])/i, maxIterations: 4 },
  { provider: 'ollama', modelPattern: /(?:qwen|llama|mistral).*(?:14b|32b)/i, maxIterations: 6 },
  { provider: 'openai', modelPattern: /gpt-4(\.|o|$)/i, maxIterations: 7 },
  { provider: 'anthropic', modelPattern: /claude-3|claude-4/i, maxIterations: 7 },
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
  // TODO: 如需扩展更多 harness 字段，在此白名单中显式加入。
  const maxIterationsRaw = input.maxIterations;
  if (typeof maxIterationsRaw === 'number' && Number.isFinite(maxIterationsRaw)) {
    return { maxIterations: maxIterationsRaw };
  }
  return {};
}

export function resolveModelHarness(
  providerName: string,
  modelName: string,
  config?: ModelHarnessConfig,
): ResolvedModelHarness {
  const defaultHarness: ResolvedModelHarness = (() => {
  for (const row of MODEL_HARNESS_DEFAULTS) {
    if (row.provider && row.provider !== providerName) continue;
    if (!row.modelPattern.test(modelName)) continue;
    return { maxIterations: row.maxIterations };
  }
  return {};
  })();

  // providerPatterns 按对象插入顺序叠加（Object.entries iteration order）
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
