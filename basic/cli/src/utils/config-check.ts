import fs from 'fs-extra';
import path from 'path';
import { isValidLogLevelInput, toLogLevelName, type LogLevelInput } from '@zhin.js/logger';
import {
  diagnoseAIDependencies,
  formatAIDependencyFixCommand,
  isAiEnabledInConfig,
  packagesNeedingAiStackFix,
  diagnoseZhinStackDependencies,
  formatZhinStackFixCommand,
  packagesNeedingZhinStackFix,
  validateDatabaseConfig,
} from '@zhin.js/scaffold-wizard';
import { expandEnvironmentValue, readApplicationPluginDeclaration } from '@zhin.js/runtime';
import { findConfigFile, readConfig } from '@zhin.js/gateway/project';
import { detectLegacyConfig, formatLegacyConfigHint } from '@zhin.js/gateway/project';
import { hostModelOwnerId } from '@zhin.js/plugin-runtime';
import { loadAiConfigUtils, type AiConfigUtils } from '@zhin.js/gateway/config';

export type ConfigIssueSeverity = 'error' | 'warn' | 'info';

export interface ConfigIssue {
  severity: ConfigIssueSeverity;
  code: string;
  message: string;
  path?: string;
  fixable?: boolean;
  fixHint?: string;
}

export interface ConfigCheckResult {
  configFile: string | null;
  config: Record<string, unknown>;
  issues: ConfigIssue[];
  fixesApplied: string[];
}

function adapterPluginForContext(context: string): string {
  return `@zhin.js/adapter-${context}`;
}

function pushIssue(
  issues: ConfigIssue[],
  issue: ConfigIssue,
): void {
  issues.push(issue);
}

/** Instance aliases in `disable_plugins`; each names the top-level business block of that instance. */
function disabledPluginInstances(config: Record<string, unknown>): ReadonlySet<string> {
  return new Set(Array.isArray(config.disable_plugins)
    ? config.disable_plugins.filter((key): key is string => typeof key === 'string')
    : []);
}

function collectEnvRefs(
  value: unknown,
  keyPath: string,
  env: Record<string, string | undefined>,
  issues: ConfigIssue[],
  /** Set while walking the block of a plugin instance listed in `disable_plugins`. */
  disabledInstance?: string,
): void {
  if (typeof value === 'string') {
    expandEnvironmentValue(value, (envKey) => env[envKey], (envKey) => {
      const databaseReference = keyPath === 'database' || keyPath.startsWith('database.');
      if (disabledInstance !== undefined) {
        // The plugin never loads while disabled: not a problem now, only before re-enabling it.
        pushIssue(issues, {
          severity: 'info',
          code: 'env.unresolved_disabled_plugin',
          path: keyPath,
          message: `环境变量 ${envKey} 未设置（${keyPath}）；插件实例 ${disabledInstance} 已停用（disable_plugins），启用前再设置即可`,
          fixable: false,
          fixHint: `启用 ${disabledInstance} 前在 .env 中设置 ${envKey}=...`,
        });
        return '';
      }
      pushIssue(issues, {
        severity: databaseReference ? 'error' : 'warn',
        code: databaseReference ? 'database.env_unresolved' : 'env.unresolved',
        path: keyPath,
        message: `环境变量 ${envKey} 未设置（${keyPath}）`,
        fixable: false,
        fixHint: databaseReference
          ? `在项目根目录 .env 中设置 ${envKey}=...，或运行 zhin setup --database`
          : `在 .env 中设置 ${envKey}=...`,
      });
      return '';
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectEnvRefs(item, `${keyPath}[${index}]`, env, issues, disabledInstance));
    return;
  }
  if (value && typeof value === 'object') {
    const disabled = keyPath === '' ? disabledPluginInstances(value as Record<string, unknown>) : undefined;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      collectEnvRefs(nested, keyPath ? `${keyPath}.${key}` : key, env, issues, disabled?.has(key) ? key : disabledInstance);
    }
  }
}

function checkEndpoints(
  config: Record<string, unknown>,
  issues: ConfigIssue[],
): void {
  const endpoints = config.endpoints;
  if (endpoints === undefined) return;
  // legacy 顶层 endpoints 数组已废弃：Endpoint 收敛到 <适配器实例>.endpoints
  pushIssue(issues, {
    severity: 'error',
    code: 'endpoints.legacy_form',
    path: 'endpoints',
    message: '顶层 endpoints 数组已废弃（legacy 形态）。Endpoint 配置收敛到 <适配器实例>.endpoints；请按 v2 实例配置手动迁移',
  });
}

function checkPlugins(config: Record<string, unknown>, issues: ConfigIssue[]): void {
  try { readApplicationPluginDeclaration(config); }
  catch (error) { pushIssue(issues, {severity: 'error', code: 'plugins.invalid', path: 'plugins', message: error instanceof Error ? error.message : String(error)}); }
}
function checkLogLevel(config: Record<string, unknown>, issues: ConfigIssue[]): void {
  if (!('log_level' in config)) return;
  if (!isValidLogLevelInput(config.log_level)) {
    pushIssue(issues, {
      severity: 'warn',
      code: 'config.log_level_invalid',
      path: 'log_level',
      message: `log_level 无效: ${JSON.stringify(config.log_level)}（推荐 debug/info/warn/error/silent，兼容 0-4）`,
      fixable: true,
      fixHint: 'log_level: info',
    });
  }
}

function checkDatabase(
  config: Record<string, unknown>,
  issues: ConfigIssue[],
  env: Record<string, string | undefined>,
): void {
  const database = config.database;
  if (!database || typeof database !== 'object' || Array.isArray(database)) return;
  const dialect = String((database as Record<string, unknown>).dialect ?? '');
  if (dialect === 'postgres') {
    pushIssue(issues, {
      severity: 'warn',
      code: 'database.dialect_postgres',
      path: 'database.dialect',
      message: 'database.dialect 应使用 pg 而非 postgres',
      fixable: true,
      fixHint: 'zhin config check --fix',
    });
    return;
  }
  for (const issue of validateDatabaseConfig(database, env)) {
    const environmentMissing = issue.kind === 'env_missing';
    pushIssue(issues, {
      severity: 'error',
      code: environmentMissing ? 'database.env_unresolved' : 'database.invalid',
      path: issue.path,
      message: issue.message,
      fixable: false,
      fixHint: environmentMissing
        ? `在项目根目录 .env 中设置 ${issue.envKey}=...，或运行 zhin setup --database`
        : '运行 zhin setup --database 重新配置',
    });
  }
}

function checkZhinStackDependencies(
  cwd: string,
  config: Record<string, unknown>,
  issues: ConfigIssue[],
): void {
  const diagnosis = diagnoseZhinStackDependencies(cwd, config);
  const fixPackages = packagesNeedingZhinStackFix(diagnosis);

  if (fixPackages.length > 0) {
    pushIssue(issues, {
      severity: 'error',
      code: 'zhin.deps_mismatch',
      path: 'package.json',
      message: `Zhin 生态依赖需修复: ${fixPackages.join(', ')}${
        diagnosis.incompatibleInstalled.length > 0
          ? `（${diagnosis.incompatibleInstalled.map((issue) => issue.reason).join('；')}）`
          : ''
      }`,
      fixable: true,
      fixHint: formatZhinStackFixCommand(fixPackages, diagnosis.required),
    });
  }

  if (diagnosis.notInstalled.length > 0) {
    pushIssue(issues, {
      severity: 'warn',
      code: 'zhin.deps_not_installed',
      path: 'node_modules',
      message: `Zhin 生态依赖已声明但未安装: ${diagnosis.notInstalled.join(', ')}`,
      fixHint: 'pnpm install',
    });
  }
}

function checkAiDependencies(
  cwd: string,
  config: Record<string, unknown>,
  issues: ConfigIssue[],
): void {
  const diagnosis = diagnoseAIDependencies(cwd, config);
  if (!diagnosis) return;

  const fixPackages = packagesNeedingAiStackFix(diagnosis);

  if (fixPackages.length > 0) {
    pushIssue(issues, {
      severity: 'error',
      code: 'ai.deps_missing',
      path: 'package.json',
      message: `AI 已启用但 package.json AI 栈需修复: ${fixPackages.join(', ')}${
        diagnosis.incompatibleInstalled.length > 0
          ? `（${diagnosis.incompatibleInstalled.map((issue) => issue.reason).join('；')}）`
          : ''
      }`,
      fixable: true,
      fixHint: formatAIDependencyFixCommand(fixPackages, diagnosis.required),
    });
  }

  if (diagnosis.notInstalled.length > 0) {
    pushIssue(issues, {
      severity: 'warn',
      code: 'ai.deps_not_installed',
      path: 'node_modules',
      message: `AI 依赖已声明但未安装: ${diagnosis.notInstalled.join(', ')}`,
      fixHint: 'pnpm install',
    });
  }
}

function checkAi(
  config: Record<string, unknown>, issues: ConfigIssue[], aiUtils: AiConfigUtils | null, hostOwnerId: string,
): void {
  const ai = config.ai;
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return;
  const raw = ai as Record<string, unknown>;
  const deprecated = (code: string, keyPath: string, reason: string): void => {
    pushIssue(issues, { severity: 'warn', code, path: keyPath,
      message: `${keyPath} 已弃用：${reason}`, fixable: true, fixHint: 'zhin config check --fix' });
  };
  for (const { key, reason } of aiUtils?.findDeprecatedAgentConfigKeys?.(raw.agent) ?? []) {
    deprecated(`ai.agent_${key}_deprecated`, `ai.agent.${key}`, reason);
  }
  for (const { agent, key, reason } of aiUtils?.findDeprecatedAgentBindingKeys?.(raw.agents) ?? []) {
    deprecated('ai.agent_routing_deprecated', `ai.agents.${agent}.${key}`, reason);
  }
  for (const key of ['allowedTools', 'disabledTools', 'toolSearch', 'memoryMcp']) {
    if (Object.hasOwn(raw, key)) deprecated(`ai.${key}_deprecated`, `ai.${key}`, '已废弃或不再生效');
  }
  const legacy = ['providers', 'modelCatalog', 'modelPolicy', 'defaultProvider', 'decisions']
    .filter(key => Object.hasOwn(ai, key));
  if (legacy.length) {
    pushIssue(issues, { severity: 'error', code: 'ai.inference_migration_required', path: 'ai',
      message: `AI 模型配置需要显式迁移：${legacy.join(', ')}`,
      fixHint: '预览并确认 AI 运行时迁移；config check --fix 不会迁移账号或凭据' });
    return;
  }
  if (!aiUtils?.validateModelRuntimeConfig) {
    pushIssue(issues, { severity: 'error', code: 'ai.agent_missing', path: 'ai',
      message: 'AI 运行时所需的 @zhin.js/agent 未安装或版本不支持', fixHint: '更新 AI 栈后重试' });
    return;
  }
  for (const message of aiUtils.validateModelRuntimeConfig(ai, hostOwnerId)) {
    pushIssue(issues, { severity: 'error', code: 'ai.model_config_invalid', path: 'ai', message });
  }
}

export async function runConfigCheck(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): Promise<ConfigCheckResult> {
  const issues: ConfigIssue[] = [];
  const fixesApplied: string[] = [];
  const configFile = findConfigFile(cwd);

  if (!configFile) {
    pushIssue(issues, {
      severity: 'error',
      code: 'config.missing',
      message: '未找到 Root 配置文件（config/zhin.config 的 YAML 或 JSON）',
      fixHint: 'zhin setup',
    });
    return { configFile: null, config: {}, issues, fixesApplied };
  }

  // v1 configs fail schema reading; report them as a migration, not as a parse error.
  const legacy = await detectLegacyConfig(cwd);
  if (legacy.legacy) {
    pushIssue(issues, {
      severity: 'error',
      code: 'config.legacy_v1',
      path: configFile,
      message: formatLegacyConfigHint(legacy),
      fixHint: 'zhin stop && zhin migrate instances && zhin migrate instances --apply',
    });
    return { configFile, config: {}, issues, fixesApplied };
  }

  let config: Record<string, unknown>;
  try {
    config = await readConfig(path.join(cwd, configFile));
  } catch (error) {
    pushIssue(issues, {
      severity: 'error',
      code: 'config.parse_error',
      message: `配置文件解析失败: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { configFile, config: {}, issues, fixesApplied };
  }

  const aiUtils = loadAiConfigUtils(cwd);

  checkPlugins(config, issues);
  const packageFile = path.join(cwd, 'package.json');
  if (await fs.pathExists(packageFile)) {
    const manifest = await fs.readJson(packageFile);
    if (Array.isArray(manifest.zhin?.plugins) && manifest.zhin.plugins.length) pushIssue(issues, {severity: 'error', code: 'plugins.legacy_manifest', path: 'package.json#zhin.plugins', message: '旧插件挂载声明不再参与运行；请运行 zhin migrate instances'});
  }
  checkLogLevel(config, issues);
  checkDatabase(config, issues, env);
  checkEndpoints(config, issues);
  checkZhinStackDependencies(cwd, config, issues);
  checkAiDependencies(cwd, config, issues);
  checkAi(config, issues, aiUtils, hostModelOwnerId(cwd));
  collectEnvRefs(config, '', env, issues);

  const uniqueIssues = issues.filter((issue, index) => issues.findIndex((candidate) =>
    candidate.code === issue.code
    && candidate.path === issue.path
    && candidate.message === issue.message) === index);
  return { configFile, config, issues: uniqueIssues, fixesApplied };
}

export function applyConfigFixes(
  config: Record<string, unknown>,
  cwd = process.cwd(),
): {
  config: Record<string, unknown>;
  fixes: string[];
} {
  const fixes: string[] = [];
  const next: Record<string, unknown> = { ...config };
  const aiUtils = loadAiConfigUtils(cwd);
  if (next.database && typeof next.database === 'object' && !Array.isArray(next.database)) {
    const database = { ...(next.database as Record<string, unknown>) };
    if (database.dialect === 'postgres') {
      database.dialect = 'pg';
      next.database = database;
      fixes.push('renamed database.dialect postgres → pg');
    }
  }

  // Only retired nonfunctional switches are fixed here. Model/account migration stays explicit.
  if (next.ai && aiUtils) {
    const { ai, fixes: aiFixes } = aiUtils.applyAiConfigFixes(next.ai);
    if (ai) next.ai = ai;
    fixes.push(...aiFixes);
  }
  if ('log_level' in next && isValidLogLevelInput(next.log_level)) {
    const normalized = toLogLevelName(next.log_level as LogLevelInput);
    if (next.log_level !== normalized) {
      next.log_level = normalized;
      fixes.push(`normalized log_level → ${normalized}`);
    }
  }

  return { config: next, fixes };
}

export function summarizeIssues(
  issues: ConfigIssue[],
  strict = false,
): { errors: number; warnings: number; infos: number; exitCode: number } {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warn').length;
  const infos = issues.filter((i) => i.severity === 'info').length;
  const exitCode = errors > 0 || (strict && warnings > 0) ? 1 : 0;
  return { errors, warnings, infos, exitCode };
}
