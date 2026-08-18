import {
  httpHostToken,
  type HttpHost,
  type HttpHostOptions,
  type ProcessHttpHost,
  type ScopedTokenConfig,
} from '@zhin.js/host-http';
import { bindGenerationAdmission } from '@zhin.js/plugin-runtime';
import {
  expandEnvironmentValue,
  type ConfigDocumentPort,
  type RootResourceInstaller,
  type RuntimeConfigDocument,
} from '@zhin.js/runtime';

export async function resolveHttpConfig(
  config: RuntimeConfigDocument | ConfigDocumentPort,
  envOverlay?: Readonly<Record<string, string | undefined>>,
): Promise<HttpHostOptions> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return {};
  const http = (document as Record<string, unknown>).http;
  if (!http || typeof http !== 'object') return {};
  const value = expandEnvironmentValue(
    http,
    (key) => envOverlay?.[key] ?? process.env[key],
  ) as Record<string, unknown>;
  return Object.freeze({
    host: typeof value.host === 'string' ? value.host : undefined,
    port: typeof value.port === 'number' ? value.port : undefined,
    token: typeof value.token === 'string' ? value.token : undefined,
    tokens: parseScopedTokens(value.tokens),
    corsOrigins: parseStringList(value.corsOrigins),
    apiBase: typeof value.base === 'string' ? value.base : undefined,
  });
}

export function installHttpHost(host: ProcessHttpHost): RootResourceInstaller {
  return ({ resources, admission }) => {
    const port: HttpHost = host;
    resources.provide(httpHostToken, bindGenerationAdmission(port, admission));
  };
}

function parseScopedTokens(value: unknown): readonly ScopedTokenConfig[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tokens: ScopedTokenConfig[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.token !== 'string' || !record.token) continue;
    const scope = record.scope === 'demo' || record.scope === 'full' ? record.scope : 'demo';
    tokens.push(Object.freeze({ token: record.token, scope }));
  }
  return tokens.length > 0 ? Object.freeze(tokens) : undefined;
}

function parseStringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return result.length > 0 ? Object.freeze(result) : undefined;
}

async function readConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<unknown> {
  if (!isConfigDocumentPort(config)) return config;
  return (await config.read()).document;
}

function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConfigDocumentPort>;
  return typeof candidate.read === 'function';
}
