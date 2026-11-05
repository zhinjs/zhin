import type { ProviderDriverReference } from '@zhin.js/ai/provider';
import type {
  ModelHarnessConfig,
  ModelHarnessRow,
  ResolvedModelHarness,
} from './model-harness.js';

export const MODEL_HARNESS_DEFAULTS: ModelHarnessRow[] = [
  { driver: { id: 'ollama', owner: 'root', contractVersion: '1' }, modelPattern: /(?:^|[-_:])(0\.5b|1\.5b|3b|7b)(?:$|[-_:])/i, maxIterations: 4 },
  { driver: { id: 'ollama', owner: 'root', contractVersion: '1' }, modelPattern: /(?:qwen|llama|mistral).*(?:14b|32b)/i, maxIterations: 6 },
  { driver: { id: 'openai', owner: 'root', contractVersion: '1' }, modelPattern: /gpt-4(\.|o|$)/i, maxIterations: 7 },
  { driver: { id: 'anthropic', owner: 'root', contractVersion: '1' }, modelPattern: /claude-3|claude-4/i, maxIterations: 7 },
  // Keep the existing model quirks only on explicit framework Driver contracts.
  ...['minimax', 'openai-compatible'].map(id => ({
    driver: { id, owner: 'root', contractVersion: '1' },
    modelPattern: /(?:^|\/)minimax-m\d/i,
    explorationBudget: 5,
    explorationGuidance: true,
    emptyReplyRetries: 1,
  })),
  ...['google', 'antigravity', 'openai-compatible'].map(id => ({
    driver: { id, owner: 'root', contractVersion: '1' },
    modelPattern: /(?:^|\/)gemini-/i,
    emptyReplyRetries: 1,
  })),
  // Gateway model quirks do not change the Driver-specific exploration budgets.
  ...['anthropic', 'opencode-go', 'opencode-zen'].map(id => ({
    driver: { id, owner: 'root', contractVersion: '1' },
    modelPattern: /(?:^|\/)(?:minimax-m\d|gemini-|deepseek-)/i,
    emptyReplyRetries: 1,
  })),
  ...['deepseek', 'openai-compatible'].map(id => ({
    driver: { id, owner: 'root', contractVersion: '1' },
    modelPattern: /(?:^|\/)deepseek-/i,
    emptyReplyRetries: 1,
  })),
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
  const { driver: _driver, modelPattern: _modelPattern, ...harness } = row;
  return harness;
}

export interface ModelHarnessInput {
  readonly driver: ProviderDriverReference;
  readonly serviceId: string;
  readonly modelId: string;
  readonly config?: ModelHarnessConfig;
  readonly defaults?: readonly ModelHarnessRow[];
}

/** Built-in quirks belong to framework-owned Driver contracts. User settings
 * address the actual immutable Service id, never a reusable Provider alias. */
export function resolveModelHarness(input: ModelHarnessInput): ResolvedModelHarness {
  const defaults = input.defaults ?? MODEL_HARNESS_DEFAULTS;
  const builtin: Record<string, unknown> = (() => {
    if (input.driver.owner !== 'root' || input.driver.contractVersion !== '1') return {};
    for (const row of defaults) {
      if (row.driver.id !== input.driver.id || row.driver.owner !== input.driver.owner
        || row.driver.contractVersion !== input.driver.contractVersion) continue;
      if (!row.modelPattern.test(input.modelId)) continue;
      return rowHarness(row);
    }
    return {};
  })();
  const selected = input.config?.services?.[input.serviceId];
  return sanitizeResolvedHarness(mergeModelHarnessValues(
    mergeModelHarnessValues(builtin, selected?.defaults ?? {}), selected?.models?.[input.modelId] ?? {},
  ));
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
  readonly driver: ProviderDriverReference;
  readonly serviceId: string;
  readonly modelId: string;
  readonly modelHarness?: ModelHarnessConfig;
  /** `undefined` for non-IM turns: no scene default applies. */
  readonly scene?: IterationScene;
  /** `ai.agent.maxIterations` after defaults. */
  readonly configured: number;
}

/**
 * Default `maxIterations` for a turn. Precedence: user `modelHarness`
 * (Service defaults / exact model) > a customised `ai.agent.maxIterations` >
 * the scene default, capped by the built-in per-model row (never raised).
 */
export function resolveTurnMaxIterations(input: TurnIterationLimitInput): number {
  const override = resolveModelHarness({ ...input, config: input.modelHarness, defaults: [] }).maxIterations;
  if (override !== undefined) return override;
  const builtin = resolveModelHarness(input).maxIterations;
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
