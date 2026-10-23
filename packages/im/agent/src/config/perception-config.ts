/**
 * `ai.multimodal.perception` schema and validation (shared by AIService
 * startup and `zhin config check`).
 */
/** Media kinds the perception pre-pass can describe. Audio stays on the STT path. */
export type PerceptionMediaKind = 'image' | 'video' | 'file';

export const PERCEPTION_MEDIA_KINDS: readonly PerceptionMediaKind[] = Object.freeze(['image', 'video', 'file']);

/** Raw `ai.multimodal.perception` as written in config. */
export interface PerceptionConfigInput {
  provider?: string;
  model?: string;
  /** 按顺序尝试的备用识图模型，不改变主对话模型。 */
  fallbacks?: readonly { provider: string; model: string }[];
  kinds?: readonly string[];
  maxChars?: number;
  timeoutMs?: number;
  maxItemsPerTurn?: number;
}

export interface ResolvedPerceptionConfig {
  readonly provider: string;
  readonly model: string;
  readonly fallbacks?: readonly { readonly provider: string; readonly model: string }[];
  readonly kinds: readonly PerceptionMediaKind[];
  readonly maxChars: number;
  readonly timeoutMs: number;
  readonly maxItemsPerTurn: number;
}

export const DEFAULT_PERCEPTION_SETTINGS = Object.freeze({
  kinds: Object.freeze(['image']) as readonly PerceptionMediaKind[],
  maxChars: 800,
  timeoutMs: 30_000,
  maxItemsPerTurn: 4,
});

function positiveInteger(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }
  return value;
}

/**
 * Validate `ai.multimodal.perception`. `undefined` (not configured) returns
 * `undefined`: the pre-pass is off and media handling is unchanged.
 */
export function resolvePerceptionConfig(
  raw: PerceptionConfigInput | undefined | null,
  providerAliases?: readonly string[],
): ResolvedPerceptionConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  const base = 'ai.multimodal.perception';
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${base} must be an object`);
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : '';
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  if (!provider) throw new Error(`${base}.provider is required (an ai.providers alias)`);
  if (!model) throw new Error(`${base}.model is required`);
  if (providerAliases && !providerAliases.includes(provider)) {
    throw new Error(`${base}.provider "${provider}" is not defined in ai.providers`);
  }
  const fallbacks: { provider: string; model: string }[] = [];
  if (raw.fallbacks !== undefined) {
    if (!Array.isArray(raw.fallbacks)) throw new Error(`${base}.fallbacks must be an array`);
    const seen = new Set([JSON.stringify([provider, model])]);
    for (const [index, item] of raw.fallbacks.entries()) {
      const path = `${base}.fallbacks[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`${path} must contain provider and model`);
      }
      const candidate = {
        provider: typeof item.provider === 'string' ? item.provider.trim() : '',
        model: typeof item.model === 'string' ? item.model.trim() : '',
      };
      if (!candidate.provider || !candidate.model) throw new Error(`${path} must contain provider and model`);
      if (providerAliases && !providerAliases.includes(candidate.provider)) {
        throw new Error(`${path}.provider "${candidate.provider}" is not defined in ai.providers`);
      }
      const key = JSON.stringify([candidate.provider, candidate.model]);
      if (!seen.has(key)) {
        seen.add(key);
        fallbacks.push(Object.freeze({ provider: candidate.provider, model: candidate.model }));
      }
    }
  }
  let kinds = DEFAULT_PERCEPTION_SETTINGS.kinds;
  if (raw.kinds !== undefined) {
    if (!Array.isArray(raw.kinds) || raw.kinds.length === 0) {
      throw new Error(`${base}.kinds must be a non-empty list of ${PERCEPTION_MEDIA_KINDS.join(' | ')}`);
    }
    const invalid = raw.kinds.filter((kind) => !PERCEPTION_MEDIA_KINDS.includes(kind as PerceptionMediaKind));
    if (invalid.length > 0) {
      throw new Error(`${base}.kinds: unsupported ${invalid.join(', ')} (allowed: ${PERCEPTION_MEDIA_KINDS.join(', ')}; audio uses ai.multimodal.audio)`);
    }
    kinds = Object.freeze([...new Set(raw.kinds as PerceptionMediaKind[])]);
  }
  return Object.freeze({
    provider,
    model,
    ...(fallbacks.length ? { fallbacks: Object.freeze(fallbacks) } : {}),
    kinds,
    maxChars: positiveInteger(raw.maxChars, `${base}.maxChars`, DEFAULT_PERCEPTION_SETTINGS.maxChars),
    timeoutMs: positiveInteger(raw.timeoutMs, `${base}.timeoutMs`, DEFAULT_PERCEPTION_SETTINGS.timeoutMs),
    maxItemsPerTurn: positiveInteger(raw.maxItemsPerTurn, `${base}.maxItemsPerTurn`, DEFAULT_PERCEPTION_SETTINGS.maxItemsPerTurn),
  });
}
