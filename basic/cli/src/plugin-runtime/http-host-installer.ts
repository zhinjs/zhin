import { Logger, formatCompact } from '@zhin.js/logger';
import { createHttpHost, httpHostToken, type HttpHostOptions, type ScopedTokenConfig } from '@zhin.js/host-http';
import {
  expandEnvironmentValue,
  type ConfigDocumentPort,
  type RootResourceInstaller,
  type RuntimeConfigDocument,
} from '@zhin.js/runtime';

const logger = new Logger(null, 'HttpHost');

export async function resolveHttpConfig(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<HttpHostOptions> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return {};
  const http = (document as Record<string, unknown>).http;
  if (!http || typeof http !== 'object') return {};
  const value = expandEnvironmentValue(
    http,
    (key) => process.env[key],
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

export function installHttpHost(options: HttpHostOptions): RootResourceInstaller {
  return ({ resources, lifecycle, handoff }) => {
    const host = createHttpHost(options);
    resources.provide(httpHostToken, host);
    lifecycle.add(() => host.close());
    handoff.add({
      // 新代际 listen 之前先释放旧代际的端口，否则旧 server 要等 commit 后的
      // 异步 dispose 才关闭，listen 必中 EADDRINUSE（Console 静默消失）。
      quiescePrevious: async (previous) => {
        const previousHost = previous.resources
          .get(previous.root)
          ?.get(httpHostToken.id) as { close(): Promise<void> } | undefined;
        await previousHost?.close();
      },
      activateNext: async () => {
        try {
          await host.listen();
        } catch (error) {
          // Kitchen-sink / dual-dev often already has Console on 8086.
          // Soft-fail so Adapter + Agent Host generation can still commit.
          if (isAddressInUse(error)) {
            logger.warn(formatCompact({
              op: 'http_listen_skip',
              reason: 'eaddrinuse',
              host: options.host ?? '127.0.0.1',
              port: options.port ?? 8086,
              hint: 'Console/API unavailable; IM + Agent Host still running',
            }));
            return;
          }
          throw error;
        }
      },
    });
  };
}

function isAddressInUse(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EADDRINUSE';
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
