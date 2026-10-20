/**
 * Plugin configuration. Every field is optional; defaults are deliberately
 * conservative because all upstream services are free, keyless and shared.
 * Out-of-range values are clamped to the documented bounds.
 */
import { DEFAULT_DOH_PROVIDERS, DOH_PROVIDERS, type DohProviderId } from './dns.js';

export interface NettoolsConfig {
  /** Per-user cooldown across all nettools commands/tools, seconds. 0 disables. Default 10, max 3600. */
  readonly cooldownSeconds?: number;
  /** Per-attempt HTTP timeout, ms. Default 8000, range 1000–30000. */
  readonly requestTimeoutMs?: number;
  /** Retries for transient failures (network, timeout, 429, 5xx). Default 2, range 0–5. */
  readonly maxRetries?: number;
  /** Number of check-host.net probe nodes for ping. Default 4, range 1–10. */
  readonly pingMaxNodes?: number;
  /** Wait between ping result polls, ms. Default 2000, range 500–10000. */
  readonly pingPollIntervalMs?: number;
  /** Maximum number of ping result polls. Default 5, range 1–10. */
  readonly pingMaxPolls?: number;
  /** DoH providers in fallback order. Default ["cloudflare", "alidns", "google"]. */
  readonly dohProviders?: readonly DohProviderId[];
  /** Registrars shown in a price comparison. Default 8, range 1–20. */
  readonly priceListLimit?: number;
}

export interface ResolvedNettoolsConfig {
  readonly cooldownMs: number;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
  readonly pingMaxNodes: number;
  readonly pingPollIntervalMs: number;
  readonly pingMaxPolls: number;
  readonly dohProviders: readonly DohProviderId[];
  readonly priceListLimit: number;
}

export const NETTOOLS_DEFAULTS = Object.freeze({
  cooldownSeconds: 10,
  requestTimeoutMs: 8_000,
  maxRetries: 2,
  pingMaxNodes: 4,
  pingPollIntervalMs: 2_000,
  pingMaxPolls: 5,
  priceListLimit: 8,
});

export function resolveNettoolsConfig(config: NettoolsConfig | undefined): ResolvedNettoolsConfig {
  const source = config ?? {};
  const cooldownSeconds = clampInteger(source.cooldownSeconds, NETTOOLS_DEFAULTS.cooldownSeconds, 0, 3_600);
  const providers = (source.dohProviders ?? []).filter((id): id is DohProviderId => Object.hasOwn(DOH_PROVIDERS, id));
  return Object.freeze({
    cooldownMs: cooldownSeconds * 1000,
    requestTimeoutMs: clampInteger(source.requestTimeoutMs, NETTOOLS_DEFAULTS.requestTimeoutMs, 1_000, 30_000),
    maxRetries: clampInteger(source.maxRetries, NETTOOLS_DEFAULTS.maxRetries, 0, 5),
    pingMaxNodes: clampInteger(source.pingMaxNodes, NETTOOLS_DEFAULTS.pingMaxNodes, 1, 10),
    pingPollIntervalMs: clampInteger(source.pingPollIntervalMs, NETTOOLS_DEFAULTS.pingPollIntervalMs, 500, 10_000),
    pingMaxPolls: clampInteger(source.pingMaxPolls, NETTOOLS_DEFAULTS.pingMaxPolls, 1, 10),
    dohProviders: Object.freeze(providers.length > 0 ? [...new Set(providers)] : [...DEFAULT_DOH_PROVIDERS]),
    priceListLimit: clampInteger(source.priceListLimit, NETTOOLS_DEFAULTS.priceListLimit, 1, 20),
  });
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}
