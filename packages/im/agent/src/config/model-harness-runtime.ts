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
  // Gemini (direct `gemini-…` or routed as `google/gemini-…`): function calls
  // occasionally end with finishReason MALFORMED_FUNCTION_CALL, and some turns
  // end with STOP but no text. Both are transient (Gemini CLI re-asks on both),
  // so re-ask once on the same model before showing the failure. Safety blocks
  // are never re-asked (see provider-resilience.ts).
  {
    modelPattern: /(?:^|\/)gemini-/i,
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
  for (const key of ['iterationExtension', 'maxTotalIterations'] as const) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) resolved[key] = Math.floor(value);
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
  defaults: readonly ModelHarnessRow[] = MODEL_HARNESS_DEFAULTS,
): ResolvedModelHarness {
  const defaultHarness: Record<string, unknown> = (() => {
    for (const row of defaults) {
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

/** ADR 0042 §7: where a turn runs decides how many model calls it gets by default. */
export type IterationScene = 'group' | 'private' | 'master-private';

export const SCENE_MAX_ITERATIONS: Readonly<Record<IterationScene, number>> = Object.freeze({
  group: 6,
  private: 10,
  'master-private': 15,
});

/** `ai.agent.maxIterations` default; a different configured value is an explicit choice and wins over the scene default. */
const BASELINE_MAX_ITERATIONS = 15;

export interface TurnIterationLimitInput {
  readonly providerName: string;
  readonly modelName: string;
  readonly modelHarness?: ModelHarnessConfig;
  /** `undefined` for non-IM turns: no scene default applies. */
  readonly scene?: IterationScene;
  /** `ai.agent.maxIterations` after defaults. */
  readonly configured: number;
}

/**
 * Default `maxIterations` for a turn. Precedence: user `modelHarness`
 * (providerPatterns / models) > a customised `ai.agent.maxIterations` >
 * the scene default, capped by the built-in per-model row (never raised).
 */
export function resolveTurnMaxIterations(input: TurnIterationLimitInput): number {
  const override = resolveModelHarness(input.providerName, input.modelName, input.modelHarness, []).maxIterations;
  if (override !== undefined) return override;
  const builtin = resolveModelHarness(input.providerName, input.modelName).maxIterations;
  if (!input.scene || input.configured !== BASELINE_MAX_ITERATIONS) return builtin ?? input.configured;
  const scene = SCENE_MAX_ITERATIONS[input.scene];
  return builtin === undefined ? scene : Math.min(builtin, scene);
}

/** Scene of an IM turn from its origin scope and the sender's roles; undefined for other origins. */
export function iterationSceneOf(turn: Readonly<{
  origin: Readonly<{ kind: string; scope?: string }>;
  principal: Readonly<{ roles: readonly string[] }>;
}> | undefined): IterationScene | undefined {
  if (turn?.origin.kind !== 'im') return undefined;
  if (turn.origin.scope === 'group') return 'group';
  return turn.principal.roles.includes('master') ? 'master-private' : 'private';
}
