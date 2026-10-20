/**
 * Which real provider the nightly tier runs against. Gemini is the default
 * (zhin's primary model since #770); MiniMax stays available for comparison
 * runs via `NIGHTLY_PROVIDER=minimax`.
 */
import type { ProviderInstanceConfig } from '@zhin.js/ai';

export type NightlyProviderId = 'gemini' | 'minimax';

export interface NightlyProvider {
  readonly id: NightlyProviderId;
  /** Environment variable (and Actions secret) holding the API key. Never logged. */
  readonly keyEnv: string;
  /** Model ids used when `NIGHTLY_MODELS` is empty. */
  readonly defaultModels: readonly string[];
  /** Matrix sampling temperature; undefined sends none. */
  readonly temperature?: number;
  readonly config: ProviderInstanceConfig;
}

export const DEFAULT_NIGHTLY_PROVIDER: NightlyProviderId = 'gemini';

/**
 * Current stable Gemini Flash-Lite (ai.google.dev/gemini-api/docs/models and the
 * API's /models list, checked 2026-10-15): multimodal input, function calling,
 * thinking, caching. Chosen for the nightly because CI's free-tier key gets 15 RPM
 * on it (gemini-3.8-flash: 5 RPM / 20 RPD). Override with NIGHTLY_MODELS.
 */
export const DEFAULT_NIGHTLY_MODEL = 'gemini-3.5-flash-lite';

type Env = Readonly<Record<string, string | undefined>>;

function trimmed(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/** Resolve the provider from env. Throws on an unknown `NIGHTLY_PROVIDER`, so typos fail loudly. */
export function resolveNightlyProvider(env: Env): NightlyProvider {
  const id = trimmed(env.NIGHTLY_PROVIDER) ?? DEFAULT_NIGHTLY_PROVIDER;
  if (id === 'gemini') {
    const thinkingLevel = trimmed(env.NIGHTLY_THINKING_LEVEL) ?? 'low';
    const baseUrl = trimmed(env.GEMINI_BASE_URL);
    return {
      id,
      keyEnv: 'GEMINI_API_KEY',
      defaultModels: [DEFAULT_NIGHTLY_MODEL],
      // Gemini 3.6+ ignores custom temperatures and returns a deprecation warning.
      temperature: undefined,
      config: {
        sdk: 'google',
        apiKey: trimmed(env.GEMINI_API_KEY),
        ...(baseUrl ? { baseUrl } : {}),
        ...(thinkingLevel !== 'off' ? { providerOptions: { google: { thinkingConfig: { thinkingLevel } } } } : {}),
        // Retries go through the eval rate limiter (rate-limit.ts), never the SDK.
        maxRetries: 0,
      },
    };
  }
  if (id === 'minimax') {
    const baseUrl = trimmed(env.MINIMAX_BASE_URL);
    return {
      id,
      keyEnv: 'MINIMAX_API_KEY',
      defaultModels: ['minimax-m3'],
      temperature: 0.2,
      config: {
        sdk: 'minimax',
        apiKey: trimmed(env.MINIMAX_API_KEY),
        ...(baseUrl ? { baseUrl } : {}),
        // Retries go through the eval rate limiter (rate-limit.ts), never the SDK.
        maxRetries: 0,
      },
    };
  }
  throw new Error(`Unknown NIGHTLY_PROVIDER "${id}" (expected gemini or minimax)`);
}

/** `NIGHTLY_MODELS` (comma-separated) or the provider's default models. */
export function resolveNightlyModels(env: Env, provider: NightlyProvider): string[] {
  const ids = (trimmed(env.NIGHTLY_MODELS) ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 ? ids : [...provider.defaultModels];
}
