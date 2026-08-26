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
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export interface ResolvedHttpConfig extends HttpHostOptions {
  /** Additional listeners that mirror the primary Host route surface. */
  readonly listeners?: readonly HttpHostOptions[];
}

export async function resolveHttpConfig(
  config: RuntimeConfigDocument | ConfigDocumentPort,
  envOverlay?: Readonly<Record<string, string | undefined>>,
  projectRoot = process.cwd(),
): Promise<ResolvedHttpConfig> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return {};
  const http = (document as Record<string, unknown>).http;
  if (!http || typeof http !== 'object') return {};
  const value = expandEnvironmentValue(
    http,
    (key) => envOverlay?.[key] ?? process.env[key],
  ) as Record<string, unknown>;
  const primary: HttpHostOptions = Object.freeze({
    host: typeof value.host === 'string' ? value.host : undefined,
    port: typeof value.port === 'number' ? value.port : undefined,
    token: typeof value.token === 'string' ? value.token : undefined,
    tokens: parseScopedTokens(value.tokens),
    corsOrigins: injectDesktopWebviewOrigins(parseStringList(value.corsOrigins), envOverlay),
    apiBase: typeof value.base === 'string' ? value.base : undefined,
    tls: await parseTlsConfig(value.tls, projectRoot),
  });
  const configuredListeners = await parseAdditionalListeners(value.listeners, primary, projectRoot);
  const listeners = await injectDesktopDeviceListener(
    configuredListeners,
    primary,
    envOverlay,
    projectRoot,
  );
  return Object.freeze({...primary, ...(listeners.length > 0 ? {listeners} : {})});
}

const DESKTOP_WEBVIEW_ORIGINS = Object.freeze([
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]);

function injectDesktopWebviewOrigins(
  configured: readonly string[] | undefined,
  envOverlay: Readonly<Record<string, string | undefined>> | undefined,
): readonly string[] | undefined {
  const origin = envOverlay?.ZHIN_DESKTOP_WEBVIEW_ORIGIN
    ?? process.env.ZHIN_DESKTOP_WEBVIEW_ORIGIN;
  if (origin === undefined) return configured;
  if (!DESKTOP_WEBVIEW_ORIGINS.includes(origin)) {
    throw new Error('ZHIN_DESKTOP_WEBVIEW_ORIGIN is not a trusted Tauri origin');
  }
  return Object.freeze([...new Set([...(configured ?? []), ...DESKTOP_WEBVIEW_ORIGINS])]);
}

/**
 * Desktop releases before the dual-listener migration may already have a
 * user-owned zhin.config.yml without http.listeners. The native shell passes
 * these trusted variables on every launch, so append the secure Device
 * listener without replacing the user's persisted configuration.
 */
async function injectDesktopDeviceListener(
  configured: readonly HttpHostOptions[],
  primary: HttpHostOptions,
  envOverlay: Readonly<Record<string, string | undefined>> | undefined,
  projectRoot: string,
): Promise<readonly HttpHostOptions[]> {
  const environment = (key: string) => envOverlay?.[key] ?? process.env[key];
  if (!parseEnabled(
    environment('ZHIN_DESKTOP_DEVICE_LISTENER_ENABLED') ?? false,
    'ZHIN_DESKTOP_DEVICE_LISTENER_ENABLED',
  )) return configured;
  const host = environment('ZHIN_DESKTOP_DEVICE_HOST')?.trim() || '0.0.0.0';
  const portValue = environment('ZHIN_DESKTOP_DEVICE_PORT')?.trim();
  const port = portValue === undefined || portValue === '' ? 17_889 : Number(portValue);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('ZHIN_DESKTOP_DEVICE_PORT must be a valid TCP port');
  }
  const existing = configured.find(listener => listener.host === host && listener.port === port);
  if (existing?.tls) return configured;
  if (existing) {
    throw new Error('Desktop Device listener conflicts with a non-TLS http.listeners entry');
  }
  const tls = await parseTlsConfig({
    enabled: true,
    keyFile: environment('ZHIN_DESKTOP_TLS_KEY_FILE'),
    certFile: environment('ZHIN_DESKTOP_TLS_CERT_FILE'),
    minVersion: 'TLSv1.2',
  }, projectRoot);
  return Object.freeze([...configured, Object.freeze({...primary, host, port, tls})]);
}

async function parseAdditionalListeners(
  value: unknown,
  primary: HttpHostOptions,
  projectRoot: string,
): Promise<readonly HttpHostOptions[]> {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new Error('http.listeners must be an array');
  const listeners: HttpHostOptions[] = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`http.listeners[${index}] must be an object`);
    }
    const listener = entry as Record<string, unknown>;
    if (!parseEnabled(listener.enabled, `http.listeners[${index}].enabled`)) continue;
    if (typeof listener.host !== 'string' || !listener.host) {
      throw new Error(`http.listeners[${index}].host is required`);
    }
    if (typeof listener.port !== 'number') {
      throw new Error(`http.listeners[${index}].port is required`);
    }
    listeners.push(Object.freeze({
      ...primary,
      host: listener.host,
      port: listener.port,
      tls: await parseTlsConfig(listener.tls, projectRoot),
    }));
  }
  return Object.freeze(listeners);
}

async function parseTlsConfig(
  value: unknown,
  projectRoot: string,
): Promise<HttpHostOptions['tls']> {
  if (value === undefined || value === null || value === false) return undefined;
  if (!value || typeof value !== 'object') throw new Error('http.tls must be an object');
  const tls = value as Record<string, unknown>;
  const enabled = parseTlsEnabled(tls.enabled);
  if (!enabled) return undefined;
  if (typeof tls.keyFile !== 'string' || !tls.keyFile
    || typeof tls.certFile !== 'string' || !tls.certFile) {
    throw new Error('http.tls.keyFile and http.tls.certFile are required');
  }
  const minVersion = tls.minVersion;
  if (minVersion !== undefined
    && !['TLSv1.2', 'TLSv1.3'].includes(String(minVersion))) {
    throw new Error('http.tls.minVersion must be TLSv1.2 or TLSv1.3');
  }
  const [key, cert, ca] = await Promise.all([
    readFile(resolveTlsPath(projectRoot, tls.keyFile)),
    readFile(resolveTlsPath(projectRoot, tls.certFile)),
    typeof tls.caFile === 'string' && tls.caFile
      ? readFile(resolveTlsPath(projectRoot, tls.caFile)) : undefined,
  ]);
  return Object.freeze({
    key, cert,
    ...(ca ? {ca} : {}),
    ...(typeof tls.passphrase === 'string' ? {passphrase: tls.passphrase} : {}),
    ...(minVersion ? {minVersion: minVersion as 'TLSv1.2' | 'TLSv1.3'} : {}),
    ...(typeof tls.ciphers === 'string' && tls.ciphers ? {ciphers: tls.ciphers} : {}),
  });
}

function parseTlsEnabled(value: unknown): boolean {
  return parseEnabled(value, 'http.tls.enabled');
}

function parseEnabled(value: unknown, field: string): boolean {
  if (value === undefined || value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'on'].includes(normalized)) return true;
    if (['false', '0', 'off', ''].includes(normalized)) return false;
  }
  throw new Error(`${field} must be a boolean`);
}

function resolveTlsPath(projectRoot: string, value: string): string {
  return isAbsolute(value) ? value : resolve(projectRoot, value);
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
    const principalId = typeof record.principalId === 'string' && record.principalId.trim() === record.principalId
      && record.principalId.length > 0
      ? record.principalId
      : undefined;
    tokens.push(Object.freeze({ token: record.token, scope, ...(principalId ? { principalId } : {}) }));
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
