import { createRequire } from 'node:module';
import fs from 'fs-extra';
import path from 'node:path';
import generated from './stack-versions.generated.json' with { type: 'json' };
import { DATABASE_PACKAGES } from './types.js';
import type { PackageJsonLike } from './project-deps.js';
import {
  findMissingPackageDependencies,
  findUnresolvedPackageInstalls,
  isAiEnabledInConfig,
} from './project-deps.js';

/**
 * Zhin 生态 npm 包版本 SSOT（create-zhin-app / zhin setup / doctor --fix）。
 * 由 scripts/sync-scaffold-deps.mjs 从 monorepo package.json 生成，pnpm bump 时自动同步。
 */
export const ZHIN_STACK_VERSIONS = generated.zhinStack;

export type ZhinStackPackage = keyof typeof generated.zhinStack;

const HOST_CONSOLE_PLUGINS = new Set([
  '@zhin.js/host-router',
  '@zhin.js/host-api',
]);

function parseMajor(versionSpec: string | undefined): number | undefined {
  if (!versionSpec?.trim()) return undefined;
  if (versionSpec === 'workspace:*') return undefined;
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

function resolveStackVersion(packageName: string): string {
  return ZHIN_STACK_VERSIONS[packageName as ZhinStackPackage] ?? 'latest';
}

function collectZhinPluginsFromConfig(config: Record<string, unknown>): string[] {
  const plugins = Array.isArray(config.plugins)
    ? config.plugins.filter((p): p is string => typeof p === 'string')
    : [];
  return [...new Set(plugins.filter((p) => p.startsWith('@zhin.js/')))];
}

/** create-zhin / minimal-bot 默认 Host 端口（避免与常见 8086 占用冲突） */
export const DEFAULT_CREATE_BOT_HTTP_PORT = 8068;

/** create-zhin 生成项目的 .npmrc（避免全局 strict-peer-dependencies 阻断 AI 栈安装） */
export const CREATE_BOT_NPMRC = 'strict-peer-dependencies=false\n';

function majorFromRange(range: string): string {
  const match = range.match(/(\d+)/);
  return match?.[1] ?? range;
}

/** create-zhin 生成项目的 pnpm 配置 */
export function getCreateBotPnpmConfig(aiEnabled?: boolean): Record<string, unknown> {
  const config: Record<string, unknown> = {
    onlyBuiltDependencies: ['esbuild'],
  };
  if (aiEnabled) {
    const aiStack = generated.aiStack as Record<string, string>;
    config.peerDependencyRules = {
      allowedVersions: {
        ai: majorFromRange(aiStack.ai ?? '^7.0.0'),
        '@ai-sdk/openai-compatible': majorFromRange(aiStack['@ai-sdk/openai-compatible'] ?? '^3.0.0'),
        '@ai-sdk/openai': majorFromRange(aiStack['@ai-sdk/openai'] ?? '^4.0.0'),
        '@ai-sdk/anthropic': majorFromRange(aiStack['@ai-sdk/anthropic'] ?? '^4.0.0'),
        '@ai-sdk/google': majorFromRange(aiStack['@ai-sdk/google'] ?? '^4.0.0'),
        '@ai-sdk/deepseek': majorFromRange(aiStack['@ai-sdk/deepseek'] ?? '^3.0.0'),
      },
    };
  }
  return config;
}

/** create-zhin-app 默认 bot 骨架依赖（不含适配器 / AI / 数据库驱动） */
export function getCreateBotBaseDependencies(): Record<string, string> {
  return {
    'zhin.js': ZHIN_STACK_VERSIONS['zhin.js'],
    '@zhin.js/cli': ZHIN_STACK_VERSIONS['@zhin.js/cli'],
    '@zhin.js/host-router': ZHIN_STACK_VERSIONS['@zhin.js/host-router'],
    '@zhin.js/client': ZHIN_STACK_VERSIONS['@zhin.js/client'],
    '@zhin.js/host-api': ZHIN_STACK_VERSIONS['@zhin.js/host-api'],
    '@zhin.js/contract': ZHIN_STACK_VERSIONS['@zhin.js/contract'],
    '@zhin.js/satori': ZHIN_STACK_VERSIONS['@zhin.js/satori'],
  };
}

/** 根据 zhin.config 推导应声明的 @zhin.js/* / zhin.js 依赖 */
export function getRequiredZhinDependenciesForConfig(config: Record<string, unknown>): Record<string, string> {
  const deps: Record<string, string> = {
    'zhin.js': ZHIN_STACK_VERSIONS['zhin.js'],
  };

  for (const plugin of collectZhinPluginsFromConfig(config)) {
    deps[plugin] = resolveStackVersion(plugin);
  }

  const database = config.database;
  if (database && typeof database === 'object' && !Array.isArray(database)) {
    deps['@zhin.js/database'] = ZHIN_STACK_VERSIONS['@zhin.js/database'];
    const dialect = String((database as Record<string, unknown>).dialect ?? '');
    const driver = DATABASE_PACKAGES[dialect as keyof typeof DATABASE_PACKAGES];
    if (driver) {
      deps[driver] = 'latest';
    }
  }

  const usesHost = collectZhinPluginsFromConfig(config).some((p) => HOST_CONSOLE_PLUGINS.has(p));
  if (usesHost) {
    for (const pkg of ['@zhin.js/host-router', '@zhin.js/host-api'] as const) {
      deps[pkg] = ZHIN_STACK_VERSIONS[pkg];
    }
  }

  return deps;
}

export interface ZhinStackIncompatibility {
  package: string;
  reason: string;
}

export function findOutdatedZhinStackInPackageJson(
  pkg: PackageJsonLike,
  required: Record<string, string>,
): string[] {
  const outdated: string[] = [];
  for (const [name, minSpec] of Object.entries(required)) {
    const declared = getDeclaredPackageVersion(pkg, name);
    if (!declared || declared === 'workspace:*') continue;
    const declaredMajor = parseMajor(declared);
    const minMajor = parseMajor(minSpec);
    if (declaredMajor != null && minMajor != null && declaredMajor < minMajor) {
      outdated.push(name);
    }
  }
  return outdated;
}

export function findInstalledZhinStackIncompatibilities(
  cwd: string,
  pkg: PackageJsonLike,
  config: Record<string, unknown>,
): ZhinStackIncompatibility[] {
  const issues: ZhinStackIncompatibility[] = [];
  const zhinMajor = resolvePackageMajor(cwd, pkg, 'zhin.js');
  const agentDeclared = getDeclaredPackageVersion(pkg, '@zhin.js/agent');
  const aiEnabled = isAiEnabledInConfig(config);

  if (zhinMajor != null && zhinMajor < 4 && (aiEnabled || agentDeclared)) {
    issues.push({
      package: 'zhin.js',
      reason: 'zhin.js 4.x 才支持 @zhin.js/agent 与 AI 安装分层（ADR 0019），请升级 zhin.js',
    });
  }

  if (aiEnabled && !agentDeclared) {
    // missing 由 missingFromPackageJson 处理；此处只报版本组合问题
  }

  const agentMajor = resolvePackageMajor(cwd, pkg, '@zhin.js/agent');
  if (agentMajor != null && agentMajor < 1 && aiEnabled) {
    issues.push({
      package: '@zhin.js/agent',
      reason: '@zhin.js/agent 1.x 与 zhin.js 4.x / AI SDK 7 配套，请升级 @zhin.js/agent',
    });
  }

  return issues;
}

export interface ZhinStackDiagnosis {
  required: Record<string, string>;
  missingFromPackageJson: string[];
  outdatedInPackageJson: string[];
  incompatibleInstalled: ZhinStackIncompatibility[];
  notInstalled: string[];
}

export function packagesNeedingZhinStackFix(diagnosis: ZhinStackDiagnosis): string[] {
  const names = new Set<string>([
    ...diagnosis.missingFromPackageJson,
    ...diagnosis.outdatedInPackageJson,
  ]);
  for (const issue of diagnosis.incompatibleInstalled) {
    names.add(issue.package);
  }
  return [...names];
}

export function diagnoseZhinStackDependencies(
  cwd: string,
  config: Record<string, unknown>,
  pkg?: PackageJsonLike,
): ZhinStackDiagnosis {
  const required = getRequiredZhinDependenciesForConfig(config);
  const packageJsonPath = path.join(cwd, 'package.json');
  const packageJson = pkg ?? (fs.existsSync(packageJsonPath)
    ? fs.readJsonSync(packageJsonPath) as PackageJsonLike
    : {});
  const missingFromPackageJson = findMissingPackageDependencies(packageJson, required);
  const outdatedInPackageJson = findOutdatedZhinStackInPackageJson(packageJson, required);
  const incompatibleInstalled = findInstalledZhinStackIncompatibilities(cwd, packageJson, config);
  const declared = Object.keys(required).filter((name) => !missingFromPackageJson.includes(name));
  const notInstalled = findUnresolvedPackageInstalls(cwd, declared);
  return {
    required,
    missingFromPackageJson,
    outdatedInPackageJson,
    incompatibleInstalled,
    notInstalled,
  };
}

export function formatZhinStackFixCommand(packages: string[], required: Record<string, string>): string {
  if (packages.length === 0) return 'pnpm install';
  const specs = packages.map((name) => `${name}@${required[name] ?? 'latest'}`);
  return `pnpm add ${specs.join(' ')}`;
}
