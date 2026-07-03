import { createRequire } from 'node:module';
import fs from 'fs-extra';
import path from 'node:path';
import type { AISetupConfig } from './ai.js';
import type { InitOptions } from './types.js';

/**
 * User project dependency policy: scaffolded dependencies intentionally float to latest.
 */
export const AI_STACK_VERSIONS = {
  '@zhin.js/agent': 'latest',
  zod: 'latest',
  ai: 'latest',
  '@modelcontextprotocol/sdk': 'latest',
  '@ai-sdk/openai': 'latest',
  '@ai-sdk/anthropic': 'latest',
  '@ai-sdk/google': 'latest',
  '@ai-sdk/deepseek': 'latest',
  '@ai-sdk/openai-compatible': 'latest',
} as const;

/** @deprecated 使用 AI_STACK_VERSIONS['@modelcontextprotocol/sdk'] */
export const MCP_SDK_VERSION = AI_STACK_VERSIONS['@modelcontextprotocol/sdk'];

const WIZARD_ALIAS_TO_SDK: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  deepseek: 'deepseek',
  google: 'google',
  gemini: 'google',
  ollama: 'ollama',
  moonshot: 'openai-compatible',
  zhipu: 'openai-compatible',
};

const SDK_TO_NPM_PACKAGE: Record<string, keyof typeof AI_STACK_VERSIONS> = {
  openai: '@ai-sdk/openai',
  anthropic: '@ai-sdk/anthropic',
  google: '@ai-sdk/google',
  deepseek: '@ai-sdk/deepseek',
  ollama: '@ai-sdk/openai-compatible',
  'openai-compatible': '@ai-sdk/openai-compatible',
};

const PROVIDER_SDK_PACKAGES: Record<string, { pkg: string; version: string }> = {
  openai: { pkg: '@ai-sdk/openai', version: AI_STACK_VERSIONS['@ai-sdk/openai'] },
  anthropic: { pkg: '@ai-sdk/anthropic', version: AI_STACK_VERSIONS['@ai-sdk/anthropic'] },
  google: { pkg: '@ai-sdk/google', version: AI_STACK_VERSIONS['@ai-sdk/google'] },
  gemini: { pkg: '@ai-sdk/google', version: AI_STACK_VERSIONS['@ai-sdk/google'] },
  deepseek: { pkg: '@ai-sdk/deepseek', version: AI_STACK_VERSIONS['@ai-sdk/deepseek'] },
  ollama: { pkg: '@ai-sdk/openai-compatible', version: AI_STACK_VERSIONS['@ai-sdk/openai-compatible'] },
  moonshot: { pkg: '@ai-sdk/openai-compatible', version: AI_STACK_VERSIONS['@ai-sdk/openai-compatible'] },
  zhipu: { pkg: '@ai-sdk/openai-compatible', version: AI_STACK_VERSIONS['@ai-sdk/openai-compatible'] },
};

/** @ai-sdk/* 主版本 ≥ threshold 时需 ai@7 */
const AI7_REQUIRED_SDK_MAJOR: Record<string, number> = {
  '@ai-sdk/openai-compatible': 3,
  '@ai-sdk/openai': 4,
  '@ai-sdk/anthropic': 4,
  '@ai-sdk/google': 4,
  '@ai-sdk/deepseek': 3,
};

function providerSdkPackage(provider?: string): { pkg: string; version: string } | undefined {
  if (!provider) return undefined;
  return PROVIDER_SDK_PACKAGES[provider];
}

function inferSdkId(providerAlias: string, entry?: { sdk?: string }): string | undefined {
  const explicit = entry?.sdk?.trim();
  if (explicit) return explicit;
  if (WIZARD_ALIAS_TO_SDK[providerAlias]) return WIZARD_ALIAS_TO_SDK[providerAlias];
  if (SDK_TO_NPM_PACKAGE[providerAlias]) return providerAlias;
  return undefined;
}

function packagesForSdkIds(sdkIds: Iterable<string>): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const sdkId of sdkIds) {
    const npmName = SDK_TO_NPM_PACKAGE[sdkId];
    if (!npmName) continue;
    deps[npmName] = AI_STACK_VERSIONS[npmName];
  }
  return deps;
}

function collectSdkPackagesFromSetup(ai: AISetupConfig): Record<string, string> {
  const sdkIds = new Set<string>();
  const agentProvider = ai.agentProvider ?? ai.defaultProvider;
  if (agentProvider) {
    const id = inferSdkId(agentProvider, ai.providers?.[agentProvider] as { sdk?: string });
    if (id) sdkIds.add(id);
  }
  for (const [alias, entry] of Object.entries(ai.providers ?? {})) {
    const id = inferSdkId(alias, entry as { sdk?: string });
    if (id) sdkIds.add(id);
  }
  return packagesForSdkIds(sdkIds);
}

function collectSdkPackagesFromConfig(config: { ai?: unknown }): Record<string, string> {
  const ai = config.ai;
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return {};
  const rec = ai as Record<string, unknown>;
  const providers = rec.providers as Record<string, { sdk?: string }> | undefined;
  const sdkIds = new Set<string>();

  if (providers) {
    for (const [alias, entry] of Object.entries(providers)) {
      const id = inferSdkId(alias, entry);
      if (id) sdkIds.add(id);
    }
  }

  const agents = rec.agents as Record<string, { provider?: string }> | undefined;
  if (agents && providers) {
    for (const agent of Object.values(agents)) {
      if (!agent?.provider) continue;
      const id = inferSdkId(agent.provider, providers[agent.provider]);
      if (id) sdkIds.add(id);
    }
  }

  if (sdkIds.size === 0) {
    const alias = resolveDefaultProviderFromConfig(config);
    if (alias) {
      const id = inferSdkId(alias, providers?.[alias]);
      if (id) sdkIds.add(id);
    }
  }

  return packagesForSdkIds(sdkIds);
}

function parseMajor(versionSpec: string | undefined): number | undefined {
  if (!versionSpec?.trim()) return undefined;
  const match = versionSpec.trim().replace(/^[\^~>=<]+/, '').match(/^(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function getDeclaredPackageVersion(pkg: PackageJsonLike, name: string): string | undefined {
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
}

function readInstalledMajor(cwd: string, packageName: string): number | undefined {
  const pkgJson = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgJson)) return undefined;
  try {
    const req = createRequire(pkgJson);
    const installed = req(`${packageName}/package.json`) as { version?: string };
    return parseMajor(installed.version);
  } catch {
    return undefined;
  }
}

function resolvePackageMajor(cwd: string, pkg: PackageJsonLike, packageName: string): number | undefined {
  return readInstalledMajor(cwd, packageName) ?? parseMajor(getDeclaredPackageVersion(pkg, packageName));
}

export interface AiStackIncompatibility {
  package: string;
  reason: string;
}

export function findOutdatedAiStackInPackageJson(
  pkg: PackageJsonLike,
  required: Record<string, string>,
): string[] {
  const outdated: string[] = [];
  for (const [name, minSpec] of Object.entries(required)) {
    const declared = getDeclaredPackageVersion(pkg, name);
    if (!declared) continue;
    const declaredMajor = parseMajor(declared);
    const minMajor = parseMajor(minSpec);
    if (declaredMajor != null && minMajor != null && declaredMajor < minMajor) {
      outdated.push(name);
    }
  }
  return outdated;
}

export function findInstalledAiStackIncompatibilities(
  cwd: string,
  pkg: PackageJsonLike,
): AiStackIncompatibility[] {
  const aiMajor = resolvePackageMajor(cwd, pkg, 'ai');
  if (aiMajor == null || aiMajor >= 7) return [];

  const issues: AiStackIncompatibility[] = [];
  if (aiMajor < 7) {
    issues.push({
      package: 'ai',
      reason: 'ai@6 与 @ai-sdk/openai-compatible@3（v4 model spec）不兼容，请升级 ai 至 ^7.0.0',
    });
  }

  for (const [name, threshold] of Object.entries(AI7_REQUIRED_SDK_MAJOR)) {
    const major = resolvePackageMajor(cwd, pkg, name);
    if (major == null || major < threshold) continue;
    issues.push({
      package: name,
      reason: `${name}@${major} 需要 ai@7（当前 ai@${aiMajor}）`,
    });
  }

  return issues;
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
    agentProvider: resolveDefaultProviderFromConfig(config),
    providers: ai.providers as AISetupConfig['providers'],
    memoryMcp: aiConfigNeedsMcp(ai),
  };
  const deps = {
    ...getAIDependencies(setup),
    ...collectSdkPackagesFromConfig(config),
  };
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
  outdatedInPackageJson: string[];
  incompatibleInstalled: AiStackIncompatibility[];
  notInstalled: string[];
}

export function packagesNeedingAiStackFix(diagnosis: AIDependencyDiagnosis): string[] {
  const names = new Set<string>([
    ...diagnosis.missingFromPackageJson,
    ...diagnosis.outdatedInPackageJson,
  ]);
  for (const issue of diagnosis.incompatibleInstalled) {
    names.add(issue.package);
  }
  if (diagnosis.incompatibleInstalled.some((issue) => issue.package !== 'ai')) {
    names.add('ai');
  }
  return [...names];
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
  const outdatedInPackageJson = findOutdatedAiStackInPackageJson(packageJson, required);
  const incompatibleInstalled = findInstalledAiStackIncompatibilities(cwd, packageJson);
  const declared = Object.keys(required).filter((name) => !missingFromPackageJson.includes(name));
  const notInstalled = findUnresolvedPackageInstalls(cwd, declared);
  return {
    enabled: true,
    provider: resolveDefaultProviderFromConfig(config),
    required,
    missingFromPackageJson,
    outdatedInPackageJson,
    incompatibleInstalled,
    notInstalled,
  };
}

export function formatAIDependencyFixCommand(packages: string[], required: Record<string, string>): string {
  if (packages.length === 0) return 'pnpm install';
  const specs = packages.map((name) => `${name}@${required[name] ?? 'latest'}`);
  return `pnpm add ${specs.join(' ')}`;
}

/**
 * AI 启用时安装 agent 栈 + 所选 provider 的 @ai-sdk/* + 可选 MCP SDK。
 */
export function getAIDependencies(ai?: AISetupConfig): Record<string, string> {
  if (!ai?.enabled) return {};

  const deps: Record<string, string> = {
    '@zhin.js/agent': AI_STACK_VERSIONS['@zhin.js/agent'],
    zod: AI_STACK_VERSIONS.zod,
    ai: AI_STACK_VERSIONS.ai,
    '@modelcontextprotocol/sdk': AI_STACK_VERSIONS['@modelcontextprotocol/sdk'],
    ...collectSdkPackagesFromSetup(ai),
  };

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
