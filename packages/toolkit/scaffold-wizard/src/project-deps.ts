import { createRequire } from 'node:module';
import fs from 'fs-extra';
import path from 'node:path';
import type { AISetupConfig } from './ai.js';
import type { InitOptions } from './types.js';

/** 与 monorepo 中 agent / test-bot 对齐的 MCP SDK 版本 */
export const MCP_SDK_VERSION = '^1.29.0';

const AI_STACK_VERSION = '^4.0.0';
const ZOD_VERSION = '^4.0.0';
const VERCEL_AI_VERSION = '^6.0.0';

const PROVIDER_SDK_PACKAGES: Record<string, { pkg: string; version: string }> = {
  openai: { pkg: '@ai-sdk/openai', version: '^3.0.0' },
  anthropic: { pkg: '@ai-sdk/anthropic', version: '^3.0.0' },
  google: { pkg: '@ai-sdk/google', version: '^3.0.0' },
  gemini: { pkg: '@ai-sdk/google', version: '^3.0.0' },
  deepseek: { pkg: '@ai-sdk/deepseek', version: '^1.0.0' },
  ollama: { pkg: '@ai-sdk/openai-compatible', version: '^1.0.0' },
  moonshot: { pkg: '@ai-sdk/openai-compatible', version: '^1.0.0' },
  zhipu: { pkg: '@ai-sdk/openai-compatible', version: '^1.0.0' },
};

function providerSdkPackage(provider?: string): { pkg: string; version: string } | undefined {
  if (!provider) return undefined;
  return PROVIDER_SDK_PACKAGES[provider];
}

/** 启用 AI 时将写入 package.json 的依赖名（用于向导提示与 CLI 输出） */
export function listAIDependencyNames(provider?: string, options?: { includeMcp?: boolean }): string[] {
  const names = ['@zhin.js/agent', 'zod', 'ai'];
  if (options?.includeMcp !== false) {
    names.push('@modelcontextprotocol/sdk');
  }
  const sdk = providerSdkPackage(provider);
  if (sdk && !names.includes(sdk.pkg)) {
    names.push(sdk.pkg);
  }
  return names;
}

export function formatAIDependencyHint(provider?: string, options?: { includeMcp?: boolean }): string {
  return listAIDependencyNames(provider, options).join(', ');
}

export interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** zhin.config 中是否启用了 AI（enabled 未显式 false 且存在 agents/providers） */
export function isAiEnabledInConfig(config: { ai?: unknown }): boolean {
  const ai = config.ai;
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return false;
  const rec = ai as Record<string, unknown>;
  if (rec.enabled === false) return false;
  if (rec.enabled === true) return true;
  const agents = rec.agents;
  if (agents && typeof agents === 'object' && !Array.isArray(agents) && Object.keys(agents).length > 0) {
    return true;
  }
  const providers = rec.providers;
  if (providers && typeof providers === 'object' && !Array.isArray(providers) && Object.keys(providers).length > 0) {
    return true;
  }
  return false;
}

export function resolveDefaultProviderFromConfig(config: { ai?: unknown }): string | undefined {
  const ai = config.ai;
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return undefined;
  const rec = ai as Record<string, unknown>;
  const agents = rec.agents;
  if (agents && typeof agents === 'object' && !Array.isArray(agents)) {
    const zhin = (agents as Record<string, { provider?: string }>).zhin;
    if (zhin?.provider) return String(zhin.provider);
    const firstAgent = Object.values(agents as Record<string, { provider?: string }>)[0];
    if (firstAgent?.provider) return String(firstAgent.provider);
  }
  const providers = rec.providers;
  if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
    const first = Object.keys(providers as Record<string, unknown>)[0];
    if (first) return first;
  }
  if (rec.defaultProvider != null) return String(rec.defaultProvider);
  return undefined;
}

function aiConfigNeedsMcp(ai: Record<string, unknown>): boolean {
  if (ai.memoryMcp === true) return true;
  const servers = ai.mcpServers;
  return Array.isArray(servers) && servers.length > 0;
}

/** 根据 zhin.config 的 ai 段推导应安装的 production 依赖 */
export function getRequiredAIDependenciesForConfig(config: { ai?: unknown }): Record<string, string> {
  if (!isAiEnabledInConfig(config)) return {};
  const ai = config.ai as Record<string, unknown>;
  const setup: AISetupConfig = {
    enabled: true,
    defaultProvider: resolveDefaultProviderFromConfig(config),
    memoryMcp: aiConfigNeedsMcp(ai),
  };
  const deps = getAIDependencies(setup);
  if (!aiConfigNeedsMcp(ai)) {
    delete deps['@modelcontextprotocol/sdk'];
  }
  return deps;
}

export function findMissingPackageDependencies(
  pkg: PackageJsonLike,
  required: Record<string, string>,
): string[] {
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  return Object.keys(required).filter((name) => !declared.has(name));
}

export function findUnresolvedPackageInstalls(cwd: string, packageNames: string[]): string[] {
  const pkgJson = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgJson)) return [...packageNames];
  const req = createRequire(pkgJson);
  const missing: string[] = [];
  for (const name of packageNames) {
    try {
      req.resolve(`${name}/package.json`);
    } catch {
      missing.push(name);
    }
  }
  return missing;
}

export interface AIDependencyDiagnosis {
  enabled: true;
  provider?: string;
  required: Record<string, string>;
  missingFromPackageJson: string[];
  notInstalled: string[];
}

export function diagnoseAIDependencies(
  cwd: string,
  config: { ai?: unknown },
  pkg?: PackageJsonLike,
): AIDependencyDiagnosis | null {
  if (!isAiEnabledInConfig(config)) return null;
  const required = getRequiredAIDependenciesForConfig(config);
  const packageJsonPath = path.join(cwd, 'package.json');
  const packageJson = pkg ?? (fs.existsSync(packageJsonPath) ? fs.readJsonSync(packageJsonPath) as PackageJsonLike : {});
  const missingFromPackageJson = findMissingPackageDependencies(packageJson, required);
  const declared = Object.keys(required).filter((name) => !missingFromPackageJson.includes(name));
  const notInstalled = findUnresolvedPackageInstalls(cwd, declared);
  return {
    enabled: true,
    provider: resolveDefaultProviderFromConfig(config),
    required,
    missingFromPackageJson,
    notInstalled,
  };
}

export function formatAIDependencyFixCommand(missing: string[], required: Record<string, string>): string {
  if (missing.length === 0) return 'pnpm install';
  const specs = missing.map((name) => `${name}@${required[name] ?? 'latest'}`);
  return `pnpm add ${specs.join(' ')}`;
}

/**
 * AI 启用时安装 agent 栈 + 所选 provider 的 @ai-sdk/* + 可选 MCP SDK。
 */
export function getAIDependencies(ai?: AISetupConfig): Record<string, string> {
  if (!ai?.enabled) return {};

  const deps: Record<string, string> = {
    '@zhin.js/agent': AI_STACK_VERSION,
    zod: ZOD_VERSION,
    ai: VERCEL_AI_VERSION,
    '@modelcontextprotocol/sdk': MCP_SDK_VERSION,
  };

  const sdk = providerSdkPackage(ai.defaultProvider);
  if (sdk) {
    deps[sdk.pkg] = sdk.version;
  }

  return deps;
}

/**
 * AI 会话持久化默认开启时，若用户未选数据库则自动补 SQLite（零配置、与 inbox 一致）。
 * `-y` Stable 路径 intentionally 无数据库，与 examples/minimal-bot 对齐，此处跳过。
 */
export function ensureDatabaseForAI(options: InitOptions): void {
  if (options.yes) return;
  if (!options.ai?.enabled) return;
  if (options.database) return;

  const useDatabase = options.ai.sessions?.useDatabase !== false;
  if (!useDatabase) return;

  options.database = {
    dialect: 'sqlite',
    filename: './data/bot.db',
    mode: 'wal',
  };
}

/**
 * 所选适配器（如 GitHub）需要 database 时自动补 SQLite。
 */
export function ensureDatabaseForAdapters(options: InitOptions): void {
  if (options.yes) return;
  if (options.database) return;
  if (!options.adapters?.requiresDatabase) return;

  options.database = {
    dialect: 'sqlite',
    filename: './data/bot.db',
    mode: 'wal',
  };
}
