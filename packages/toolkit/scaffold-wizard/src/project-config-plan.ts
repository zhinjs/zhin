import fs from 'fs-extra';
import path from 'node:path';
import yaml from 'yaml';
import {
  readPluginConfigurationMap,
  ROOT_CONFIG_FILE_NAMES,
  rootConfigFormat,
  selectRootConfigFile,
  type RootConfigFormat,
} from '@zhin.js/plugin-runtime';
import { providerSdkFor } from './ai.js';

const CONSOLE_URL = 'https://console.zhin.dev';
const SANDBOX_PLUGIN = '@zhin.js/adapter-sandbox';
const LEGACY_AI_PROVIDER_FIELDS = ['driver', 'api', 'preset', 'spec'] as const;

/** 由插件包名推导默认 instanceKey（@zhin.js/adapter-telegram → telegram） */
export function packageToInstanceKey(packageName: string): string {
  const name = packageName.includes('/')
    ? packageName.split('/').pop() ?? packageName
    : packageName;
  return name.replace(/^(adapter|plugin|service)-/, '');
}

export type ProjectConfigFormat = RootConfigFormat;

export interface LoadedProjectConfig {
  status: 'loaded' | 'missing' | 'unsupported';
  cwd: string;
  configPath?: string;
  relativePath?: string;
  format?: ProjectConfigFormat;
  config: Record<string, unknown>;
  writable: boolean;
  message?: string;
}

export interface ProjectConfigPlanOptions {
  cwd?: string;
  loaded?: LoadedProjectConfig;
  configPath?: string;
  config?: Record<string, unknown>;
  format?: ProjectConfigFormat;
  enablePlugins?: string[];
  ensureConsole?: boolean;
  ensureSandbox?: boolean;
  ensureHttp?: boolean;
  migrateAiLegacy?: boolean;
}

export interface ProjectConfigPlan {
  cwd: string;
  status: LoadedProjectConfig['status'];
  configPath?: string;
  relativePath?: string;
  format?: ProjectConfigFormat;
  writable: boolean;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  mutations: string[];
  changed: boolean;
  message?: string;
}

export interface ConsoleConfigDiagnosis {
  missingSandboxPlugin: boolean;
  missingConsoleOrigin: boolean;
  missingHttpToken: boolean;
}

function configFormatFromPath(filePath: string): ProjectConfigFormat | null {
  return rootConfigFormat(filePath) ?? null;
}

function cloneConfig(config: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

function parseConfig(content: string, format: ProjectConfigFormat): Record<string, unknown> {
  if (format === 'json') {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  }
  const parsed = yaml.parse(content) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function serializeConfig(config: Record<string, unknown>, format: ProjectConfigFormat): string {
  if (format === 'json') return `${JSON.stringify(config, null, 2)}\n`;
  return yaml.stringify(config);
}

function findProjectConfigPath(cwd: string): string | null {
  const existing = ROOT_CONFIG_FILE_NAMES
    .map((candidate) => path.join(cwd, candidate))
    .filter((configPath) => fs.existsSync(configPath));
  return selectRootConfigFile(existing) ?? null;
}

export function loadProjectConfig(cwd = process.cwd(), configPath?: string): LoadedProjectConfig {
  const resolvedPath = configPath ? path.resolve(cwd, configPath) : findProjectConfigPath(cwd);
  if (!resolvedPath) {
    return {
      status: 'missing',
      cwd,
      config: {},
      writable: false,
      message: '未找到 Root YAML/JSON 配置文件',
    };
  }

  const format = configFormatFromPath(resolvedPath);
  const relativePath = path.relative(cwd, resolvedPath) || path.basename(resolvedPath);
  if (!format) {
    return {
      status: 'unsupported',
      cwd,
      configPath: resolvedPath,
      relativePath,
      config: {},
      writable: false,
      message: `${path.basename(resolvedPath)} 暂不支持自动写入`,
    };
  }

  const content = fs.readFileSync(resolvedPath, 'utf8');
  const config = parseConfig(content, format);
  try {
    readPluginConfigurationMap(config, relativePath);
  } catch (error) {
    return {
      status: 'unsupported',
      cwd,
      configPath: resolvedPath,
      relativePath,
      format,
      config,
      writable: false,
      message: `${error instanceof Error ? error.message : String(error)}；请先运行 zhin migrate`,
    };
  }
  return {
    status: 'loaded',
    cwd,
    configPath: resolvedPath,
    relativePath,
    format,
    config,
    writable: true,
  };
}

function ensurePlugins(config: Record<string, unknown>, pluginsToAdd: readonly string[], mutations: string[]): void {
  const plugins = { ...readPluginConfigurationMap(config) };
  let changed = false;
  for (const pkg of pluginsToAdd) {
    const instanceKey = packageToInstanceKey(pkg);
    if (instanceKey in plugins) continue;
    plugins[instanceKey] = {};
    mutations.push(`added ${instanceKey} (${pkg}) to plugins`);
    changed = true;
  }
  if (changed || config.plugins === undefined) {
    config.plugins = plugins;
  }
}

function ensureHttp(config: Record<string, unknown>, mutations: string[]): void {
  const http = config.http && typeof config.http === 'object' && !Array.isArray(config.http)
    ? { ...(config.http as Record<string, unknown>) }
    : {};
  const corsOrigins = Array.isArray(http.corsOrigins)
    ? http.corsOrigins.filter((origin): origin is string => typeof origin === 'string')
    : [];

  let changed = false;
  if (!hasConsoleOrigin(corsOrigins)) {
    corsOrigins.push(CONSOLE_URL);
    http.corsOrigins = corsOrigins;
    mutations.push(`added ${CONSOLE_URL} to http.corsOrigins`);
    changed = true;
  }
  if (typeof http.token !== 'string' || http.token.trim().length === 0) {
    http.token = '${HTTP_TOKEN}';
    mutations.push('added http.token');
    changed = true;
  }
  if (changed || !config.http) {
    config.http = http;
  }
}

function sdkFromLegacyProvider(alias: string, provider: Record<string, unknown>): string {
  const candidates = LEGACY_AI_PROVIDER_FIELDS
    .map((field) => provider[field])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
  const joined = candidates.join(' ');
  if (joined.includes('ollama')) return 'ollama';
  if (joined.includes('anthropic') || joined.includes('claude')) return 'anthropic';
  if (joined.includes('google') || joined.includes('gemini')) return 'google';
  if (joined.includes('deepseek')) return 'deepseek';
  if (joined.includes('moonshot') || joined.includes('zhipu') || joined.includes('compatible')) {
    return 'openai-compatible';
  }
  return providerSdkFor(alias);
}

export function migrateAiLegacyConfig(ai: Record<string, unknown>): {
  ai: Record<string, unknown>;
  fixes: string[];
} {
  const next = cloneConfig(ai);
  const fixes: string[] = [];
  const defaultProvider = typeof next.defaultProvider === 'string' && next.defaultProvider.trim()
    ? next.defaultProvider.trim()
    : undefined;

  const providers = next.providers && typeof next.providers === 'object' && !Array.isArray(next.providers)
    ? { ...(next.providers as Record<string, unknown>) }
    : {};
  let providersChanged = false;

  for (const [alias, rawProvider] of Object.entries(providers)) {
    if (!rawProvider || typeof rawProvider !== 'object' || Array.isArray(rawProvider)) continue;
    const provider = { ...(rawProvider as Record<string, unknown>) };
    const hasLegacyField = LEGACY_AI_PROVIDER_FIELDS.some((field) => field in provider);
    if (!provider.sdk && hasLegacyField) {
      provider.sdk = sdkFromLegacyProvider(alias, provider);
      fixes.push(`migrated ai.providers.${alias}.driver/api to sdk`);
      providersChanged = true;
    }
    for (const field of LEGACY_AI_PROVIDER_FIELDS) {
      if (field in provider) {
        delete provider[field];
        providersChanged = true;
      }
    }
    providers[alias] = provider;
  }

  if (providersChanged) {
    next.providers = providers;
  }

  if (defaultProvider) {
    const agents = next.agents && typeof next.agents === 'object' && !Array.isArray(next.agents)
      ? { ...(next.agents as Record<string, unknown>) }
      : {};
    const zhin = agents.zhin && typeof agents.zhin === 'object' && !Array.isArray(agents.zhin)
      ? { ...(agents.zhin as Record<string, unknown>) }
      : {};
    if (!zhin.provider) {
      zhin.provider = defaultProvider;
      fixes.push('migrated ai.defaultProvider to ai.agents.zhin.provider');
    }
    const legacyAgent = next.agent && typeof next.agent === 'object' && !Array.isArray(next.agent)
      ? next.agent as Record<string, unknown>
      : {};
    const legacyModel = typeof legacyAgent.chatModel === 'string'
      ? legacyAgent.chatModel
      : typeof legacyAgent.visionModel === 'string'
        ? legacyAgent.visionModel
        : undefined;
    if (legacyModel && !zhin.model) {
      zhin.model = legacyModel;
      fixes.push('migrated ai.agent.chatModel to ai.agents.zhin.model');
    }
    agents.zhin = zhin;
    next.agents = agents;
    delete next.defaultProvider;
  }

  return { ai: next, fixes };
}

function applyAiLegacyMigration(config: Record<string, unknown>, mutations: string[]): void {
  if (!config.ai || typeof config.ai !== 'object' || Array.isArray(config.ai)) return;
  const { ai, fixes } = migrateAiLegacyConfig(config.ai as Record<string, unknown>);
  if (fixes.length === 0) return;
  config.ai = ai;
  mutations.push(...fixes);
}

export function createProjectConfigPlan(options: ProjectConfigPlanOptions): ProjectConfigPlan {
  const cwd = options.cwd ?? options.loaded?.cwd ?? process.cwd();
  const configuredFormat = options.format
    ?? (options.configPath ? configFormatFromPath(options.configPath) ?? undefined : undefined);
  const loaded = options.loaded ?? (
    options.config
      ? {
        status: 'loaded' as const,
        cwd,
        configPath: options.configPath,
        relativePath: options.configPath ? path.relative(cwd, options.configPath) : undefined,
        format: configuredFormat,
        config: options.config,
        writable: Boolean(options.configPath && configuredFormat),
      }
      : loadProjectConfig(cwd, options.configPath)
  );

  const sourceConfig = options.config ?? loaded.config;
  const before = cloneConfig(sourceConfig);
  const after = cloneConfig(sourceConfig);
  const mutations: string[] = [];

  if (loaded.status === 'loaded' || options.config) {
    if (options.ensureSandbox) {
      ensurePlugins(after, [SANDBOX_PLUGIN], mutations);
    }
    if (options.enablePlugins?.length) {
      ensurePlugins(after, options.enablePlugins, mutations);
    }
    if (options.ensureConsole || options.ensureHttp) {
      // 新形态下 Console Host 由 CLI composition root 装配；Console 可达只需 http.token + corsOrigins
      ensureHttp(after, mutations);
    }
    if (options.migrateAiLegacy) {
      applyAiLegacyMigration(after, mutations);
    }
  }

  return {
    cwd,
    status: loaded.status,
    configPath: loaded.configPath,
    relativePath: loaded.relativePath,
    format: loaded.format,
    writable: loaded.writable,
    before,
    after,
    mutations,
    changed: mutations.length > 0,
    message: loaded.message,
  };
}

export function renderProjectConfigPatch(plan: ProjectConfigPlan): string {
  if (!plan.changed) return '配置无需改动。';
  const format = plan.format ?? 'yaml';
  const name = plan.relativePath ?? 'zhin.config.yml';
  return [
    `# ${name}`,
    serializeConfig(plan.after, format).trimEnd(),
    '',
  ].join('\n');
}

export async function applyProjectConfigPlan(plan: ProjectConfigPlan): Promise<boolean> {
  if (!plan.changed) return false;
  if (!plan.writable || !plan.configPath || !plan.format) return false;
  await fs.writeFile(plan.configPath, serializeConfig(plan.after, plan.format));
  return true;
}

export function diagnoseConsoleConfig(config: Record<string, unknown>): ConsoleConfigDiagnosis {
  const http = config.http && typeof config.http === 'object' && !Array.isArray(config.http)
    ? config.http as Record<string, unknown>
    : {};
  const corsOrigins = Array.isArray(http.corsOrigins) ? http.corsOrigins : [];

  const plugins = readPluginConfigurationMap(config);
  return {
    missingSandboxPlugin: !('sandbox' in plugins),
    missingConsoleOrigin: !hasConsoleOrigin(corsOrigins.filter((origin): origin is string => typeof origin === 'string')),
    missingHttpToken: typeof http.token !== 'string' || http.token.trim().length === 0,
  };
}

function hasConsoleOrigin(origins: readonly string[]): boolean {
  return origins.some((origin) => {
    try {
      return new URL(origin).origin === CONSOLE_URL;
    } catch {
      return false;
    }
  });
}

export function applyConsoleConfigFixes(config: Record<string, unknown>): boolean {
  const plan = createProjectConfigPlan({
    cwd: process.cwd(),
    config,
    ensureConsole: true,
    ensureSandbox: true,
    ensureHttp: true,
    migrateAiLegacy: true,
  });
  Object.keys(config).forEach((key) => delete config[key]);
  Object.assign(config, plan.after);
  return plan.changed;
}
