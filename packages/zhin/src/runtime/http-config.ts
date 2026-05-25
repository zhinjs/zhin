import type { AppConfig } from '../types.js';
import type { EdgeRuntimeConfig, HttpRuntimeConfig } from './types.js';

export const REMOTE_CONSOLE_ORIGIN = 'https://console.zhin.dev';

export const DEFAULT_HTTP_CORS_ORIGINS = [
  REMOTE_CONSOLE_ORIGIN,
  'http://127.0.0.1:5173',
];

function envGet(key: string): string | undefined {
  const g = globalThis as {
    Deno?: { env: { get: (k: string) => string | undefined } };
    process?: { env: Record<string, string | undefined> };
  };
  return g.Deno?.env.get(key) ?? g.process?.env[key];
}

export function resolveHttpConfig(appConfig: AppConfig): HttpRuntimeConfig {
  const http = (appConfig.http ?? {}) as Record<string, unknown>;
  const cors = http.corsOrigins;
  return {
    port: Number(http.port ?? envGet('PORT') ?? 8000),
    host: String(http.host ?? envGet('HOSTNAME') ?? '0.0.0.0'),
    token: String(http.token ?? envGet('HTTP_TOKEN') ?? ''),
    base: String(http.base ?? '/api'),
    corsOrigins: Array.isArray(cors)
      ? [...new Set(cors.map(String))]
      : [...DEFAULT_HTTP_CORS_ORIGINS],
    trustProxy:
      envGet('HTTP_TRUST_PROXY') === '1' ||
      envGet('HTTP_TRUST_PROXY') === 'true' ||
      Boolean(http.trustProxy),
  };
}

export function resolveEdgeConfig(appConfig: AppConfig): EdgeRuntimeConfig {
  const edge = (appConfig.edge ?? {}) as Record<string, unknown>;
  const queue = (edge.queue ?? {}) as Record<string, unknown>;
  const parity = edge.consoleParity === 'host' ? 'host' : 'edge';
  return {
    queueBotId: String(queue.botId ?? 'edge-bot'),
    consoleParity: parity,
  };
}
