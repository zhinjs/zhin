import { createRequire } from 'node:module';
import fs from 'fs-extra';
import path from 'node:path';
import { DATABASE_PACKAGES } from './types.js';
import { findMissingPackageDependencies, findUnresolvedPackageInstalls, isAiEnabledInConfig, type PackageJsonLike } from './project-deps.js';

/**
 * User project dependency policy: scaffolded dependencies intentionally float to latest.
 * WARNING: this is not reproducible; pin versions for production. See scaffold-wizard README.
 */
export const ZHIN_STACK_VERSIONS = {
  'zhin.js': 'latest',
  '@zhin.js/cli': 'latest',
  '@zhin.js/agent': 'latest',
  '@zhin.js/database': 'latest',
  '@zhin.js/plugin-runtime': 'latest',
  '@zhin.js/runtime': 'latest',
  '@zhin.js/adapter': 'latest',
  '@zhin.js/command': 'latest',
  '@zhin.js/component': 'latest',
  '@zhin.js/core': 'latest',
  '@zhin.js/tool': 'latest',
  '@zhin.js/host-router': 'latest',
  '@zhin.js/host-api': 'latest',
  '@zhin.js/client': 'latest',
  '@zhin.js/contract': 'latest',
  '@zhin.js/satori': 'latest',
  '@zhin.js/speech': 'latest',
  '@zhin.js/html-renderer': 'latest',
  '@zhin.js/mcp': 'latest',
  '@zhin.js/adapter-sandbox': 'latest',
  '@zhin.js/adapter-dingtalk': 'latest',
  '@zhin.js/adapter-discord': 'latest',
  '@zhin.js/adapter-email': 'latest',
  '@zhin.js/adapter-github': 'latest',
  '@zhin.js/adapter-icqq': 'latest',
  '@zhin.js/adapter-kook': 'latest',
  '@zhin.js/adapter-lark': 'latest',
  '@zhin.js/adapter-line': 'latest',
  '@zhin.js/adapter-milky': 'latest',
  '@zhin.js/adapter-napcat': 'latest',
  '@zhin.js/adapter-onebot11': 'latest',
  '@zhin.js/adapter-onebot12': 'latest',
  '@zhin.js/adapter-qq': 'latest',
  '@zhin.js/adapter-satori': 'latest',
  '@zhin.js/adapter-slack': 'latest',
  '@zhin.js/adapter-telegram': 'latest',
  '@zhin.js/adapter-wechat-mp': 'latest',
  '@zhin.js/adapter-wecom': 'latest',
  '@zhin.js/adapter-weixin-ilink': 'latest',
} as const;

export type ZhinStackPackage = keyof typeof ZHIN_STACK_VERSIONS;

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
  // legacy 数组形式：条目即包名
  if (Array.isArray(config.plugins)) {
    const plugins = config.plugins.filter((p): p is string => typeof p === 'string');
    return [...new Set(plugins.filter((p) => p.startsWith('@zhin.js/')))];
  }
  // 新 runtime：plugins 为 instanceKey 映射，包名在 package.json zhin.plugins 清单中，
  // 无法从配置推导；仅收集直接以包名出现的键（防御性）
  if (config.plugins && typeof config.plugins === 'object') {
    return Object.keys(config.plugins as Record<string, unknown>).filter((key) => key.startsWith('@zhin.js/'));
  }
  return [];
}

/** create-zhin / minimal-bot 默认 Host 端口（避免与常见 8086 占用冲突） */
export const DEFAULT_CREATE_BOT_HTTP_PORT = 8068;

/** create-zhin 生成项目的 .npmrc（避免全局 strict-peer-dependencies 阻断 AI 栈安装） */
export const CREATE_BOT_NPMRC = 'strict-peer-dependencies=false\n';

/** create-zhin 生成项目的 pnpm 配置 */
export function getCreateBotPnpmConfig(_aiEnabled?: boolean): Record<string, unknown> {
  return {
    onlyBuiltDependencies: ['esbuild'],
  };
}

/** create-zhin-app Plugin Runtime 骨架 production 依赖（不含适配器 / AI / 数据库驱动） */
export function getCreateBotBaseDependencies(): Record<string, string> {
  return {
    'zhin.js': ZHIN_STACK_VERSIONS['zhin.js'],
    '@zhin.js/plugin-runtime': ZHIN_STACK_VERSIONS['@zhin.js/plugin-runtime'],
    '@zhin.js/runtime': ZHIN_STACK_VERSIONS['@zhin.js/runtime'],
    '@zhin.js/adapter': ZHIN_STACK_VERSIONS['@zhin.js/adapter'],
    '@zhin.js/command': ZHIN_STACK_VERSIONS['@zhin.js/command'],
    '@zhin.js/component': ZHIN_STACK_VERSIONS['@zhin.js/component'],
    '@zhin.js/core': ZHIN_STACK_VERSIONS['@zhin.js/core'],
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
