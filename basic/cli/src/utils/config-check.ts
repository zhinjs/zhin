import fs from 'fs-extra';
import path from 'path';
import { isValidLogLevelInput, toLogLevelName, type LogLevelInput } from '@zhin.js/logger';
import {
  diagnoseAIDependencies,
  formatAIDependencyFixCommand,
  isAiEnabledInConfig,
  mergeDependenciesIntoPackageJson,
  packagesNeedingAiStackFix,
  diagnoseZhinStackDependencies,
  formatZhinStackFixCommand,
  packagesNeedingZhinStackFix,
  migrateAiLegacyConfig,
} from '@zhin.js/scaffold-wizard';
import { findConfigFile, hasLegacyTsConfig, readConfig, saveConfig } from './config-file.js';
import { loadAiConfigUtils, type AiConfigUtils } from './ai-config-loader.js';

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

const RENAMED_PLUGINS: Record<string, string> = {
  '@zhin.js/adapter-process': '@zhin.js/adapter-sandbox',
};

function adapterPluginForContext(context: string): string {
  return `@zhin.js/adapter-${context}`;
}

function pushIssue(
  issues: ConfigIssue[],
  issue: ConfigIssue,
): void {
  issues.push(issue);
}

function collectEnvRefs(
  value: unknown,
  keyPath: string,
  env: Record<string, string | undefined>,
  issues: ConfigIssue[],
): void {
  if (typeof value === 'string') {
    const match = value.match(/^\$\{([^}]+)\}$/);
    if (!match) return;
    const content = match[1];
    const bashDefault = content.match(/^([^:}]+):[-=](.*)$/);
    const envKey = bashDefault ? bashDefault[1] : content;
    const defaultValue = bashDefault ? bashDefault[2] : undefined;
    if (env[envKey] == null && defaultValue == null) {
      pushIssue(issues, {
        severity: 'warn',
        code: 'env.unresolved',
        path: keyPath,
        message: `环境变量 ${envKey} 未设置（${keyPath}）`,
        fixable: false,
        fixHint: `在 .env 中设置 ${envKey}=...`,
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectEnvRefs(item, `${keyPath}[${index}]`, env, issues));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      collectEnvRefs(nested, keyPath ? `${keyPath}.${key}` : key, env, issues);
    }
  }
}

function checkEndpoints(
  config: Record<string, unknown>,
  issues: ConfigIssue[],
): void {
  const endpoints = config.endpoints;
  if (endpoints === undefined) return;
  // legacy 顶层 endpoints 数组已废弃：Endpoint 收敛到 plugins.<适配器实例>.endpoints
  pushIssue(issues, {
    severity: 'error',
    code: 'endpoints.legacy_form',
    path: 'endpoints',
    message: '顶层 endpoints 数组已废弃（legacy 形态）。Endpoint 配置收敛到 plugins.<适配器实例>.endpoints；请运行 `zhin migrate` 或 `zhin setup --adapters` 迁移',
  });
}

function checkPlugins(config: Record<string, unknown>, issues: ConfigIssue[]): void {
  const raw = config.plugins;
  if (raw === undefined) return;
  if (Array.isArray(raw)) {
    // legacy 形态：plugins 字符串数组已废弃，整体需迁移
    pushIssue(issues, {
      severity: 'error',
      code: 'plugins.legacy_form',
      path: 'plugins',
      message: 'plugins 数组形态已废弃（legacy）。Plugin Runtime 使用 plugins.<instanceKey> 对象形态；请运行 `zhin migrate` 或 `zhin setup` 迁移',
    });
    return;
  }
  if (!raw || typeof raw !== 'object') {
    pushIssue(issues, {
      severity: 'error',
      code: 'plugins.invalid',
      path: 'plugins',
      message: 'plugins 必须是对象（plugins.<instanceKey> 形态）',
    });
    return;
  }
  // 新形态：合法键校验（与 config-composer 的 plugins 对象 Schema 对齐）
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(key)) {
      pushIssue(issues, {
        severity: 'error',
        code: 'plugins.key_invalid',
        path: `plugins.${key}`,
        message: `plugins 键名 ${JSON.stringify(key)} 非法（须为 instanceKey，字母开头，字母/数字/._-）`,
      });
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      pushIssue(issues, {
        severity: 'error',
        code: 'plugins.entry_invalid',
        path: `plugins.${key}`,
        message: `plugins.${key} 必须是对象（插件实例配置）`,
      });
    }
  }
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

function checkDatabase(config: Record<string, unknown>, issues: ConfigIssue[]): void {
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
  config: Record<string, unknown>,
  issues: ConfigIssue[],
  aiUtils: AiConfigUtils | null,
): void {
  const ai = config.ai;
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return;

  const legacy = ai as Record<string, unknown> & {
    routes?: unknown;
    defaultProvider?: unknown;
    agent?: Record<string, unknown>;
  };

  if (legacy.defaultProvider != null) {
    pushIssue(issues, {
      severity: 'warn',
      code: 'ai.default_provider_deprecated',
      path: 'ai.defaultProvider',
      message: 'ai.defaultProvider 已废弃，应使用 ai.agents.zhin.provider',
      fixable: true,
      fixHint: 'zhin config check --fix',
    });
  }
  if (legacy.agent?.chatModel != null || legacy.agent?.visionModel != null) {
    pushIssue(issues, {
      severity: 'warn',
      code: 'ai.agent_chat_model_deprecated',
      path: 'ai.agent',
      message: 'ai.agent.chatModel / visionModel 已废弃，应使用 ai.agents.zhin.model',
      fixable: true,
      fixHint: 'zhin config check --fix',
    });
  }
  if (legacy.routes != null) {
    pushIssue(issues, {
      severity: 'warn',
      code: 'ai.routes_deprecated',
      path: 'ai.routes',
      message: 'ai.routes 已废弃，应使用 ai.agents.<name>.priority/match',
      fixable: true,
      fixHint: 'zhin config check --fix',
    });
  }
  for (const key of ['allowedTools', 'disabledTools', 'toolSearch', 'memoryMcp'] as const) {
    if (key in legacy) {
      pushIssue(issues, {
        severity: 'warn',
        code: `ai.${key}_deprecated`,
        path: `ai.${key}`,
        message: `ai.${key} 已废弃或不再生效`,
        fixable: true,
        fixHint: 'zhin config check --fix',
      });
    }
  }

  const providers = legacy.providers;
  if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
    for (const [alias, prov] of Object.entries(providers)) {
      const provider = prov as Record<string, unknown>;
      const legacyField = prov && typeof prov === 'object'
        ? ['driver', 'api', 'preset', 'spec'].find((key) => key in provider)
        : undefined;
      if (legacyField) {
        pushIssue(issues, {
          severity: 'warn',
          code: 'ai.provider_driver_deprecated',
          path: `ai.providers.${alias}.${legacyField}`,
          message: `ai.providers.${alias}.${legacyField} 应迁移为 sdk`,
          fixable: true,
          fixHint: 'zhin config check --fix',
        });
      }
    }
  }

  if (!aiUtils) {
    if (isAiEnabledInConfig({ ai: legacy })) {
      pushIssue(issues, {
        severity: 'error',
        code: 'ai.agent_missing',
        path: 'ai',
        message: '配置已启用 AI，但未安装 @zhin.js/agent（zhin.js 4.x 需单独安装 AI 栈）',
        fixHint: 'zhin setup --ai 或 pnpm add @zhin.js/agent@latest zod@latest ai@latest',
      });
    } else {
      pushIssue(issues, {
        severity: 'info',
        code: 'ai.check_skipped',
        path: 'ai',
        message: '未解析到 @zhin.js/agent，跳过 AI 路由深度校验',
      });
    }
    return;
  }

  try {
    const validationAi = migrateAiLegacyConfig(legacy).ai;
    const normalized = aiUtils.normalizeAiRoutingConfig(validationAi);
    for (const err of aiUtils.validateAiRoutingConfig(normalized)) {
      pushIssue(issues, {
        severity: 'error',
        code: 'ai.routing_invalid',
        path: 'ai',
        message: err,
        fixHint: 'zhin setup --ai',
      });
    }
  } catch (error) {
    pushIssue(issues, {
      severity: 'error',
      code: 'ai.routing_invalid',
      path: 'ai',
      message: error instanceof Error ? error.message : String(error),
      fixHint: 'zhin setup --ai',
    });
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
      message: '未找到 zhin.config.{yml,yaml,json,toml}',
      fixHint: 'zhin setup',
    });
    return { configFile: null, config: {}, issues, fixesApplied };
  }

  if (configFile.endsWith('.ts') || hasLegacyTsConfig(cwd)) {
    pushIssue(issues, {
      severity: 'error',
      code: 'config.legacy_ts',
      message: 'zhin.config.ts 已不再被运行时加载，请迁移为 zhin.config.yml',
      fixHint: '参考文档 configuration.md，或运行 zhin setup 重新生成',
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
  checkLogLevel(config, issues);
  checkDatabase(config, issues);
  checkEndpoints(config, issues);
  checkZhinStackDependencies(cwd, config, issues);
  checkAiDependencies(cwd, config, issues);
  checkAi(config, issues, aiUtils);
  collectEnvRefs(config, '', env, issues);

  return { configFile, config, issues, fixesApplied };
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

  if (Array.isArray(next.plugins)) {
    const plugins = [...next.plugins.map((p) => String(p))];
    let changed = false;
    for (let i = 0; i < plugins.length; i++) {
      const old = plugins[i];
      const renamed = RENAMED_PLUGINS[old];
      if (renamed) {
        plugins[i] = renamed;
        fixes.push(`renamed plugin ${old} → ${renamed}`);
        changed = true;
      }
    }
    if (changed) next.plugins = [...new Set(plugins)];
  }

  if (next.database && typeof next.database === 'object' && !Array.isArray(next.database)) {
    const database = { ...(next.database as Record<string, unknown>) };
    if (database.dialect === 'postgres') {
      database.dialect = 'pg';
      next.database = database;
      fixes.push('renamed database.dialect postgres → pg');
    }
  }

  if (next.ai && typeof next.ai === 'object' && !Array.isArray(next.ai)) {
    const { ai, fixes: aiMigrationFixes } = migrateAiLegacyConfig(next.ai as Record<string, unknown>);
    if (aiMigrationFixes.length > 0) {
      next.ai = ai;
      fixes.push(...aiMigrationFixes);
    }
  }

  if (next.ai && aiUtils) {
    const { ai, fixes: aiFixes } = aiUtils.applyAiConfigFixes(next.ai as Record<string, unknown>);
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

export async function ensurePackageJson(cwd: string): Promise<boolean> {
  return fs.pathExists(path.join(cwd, 'package.json'));
}

/** 供 doctor 等命令复用：可选 --fix 写回配置后重新检查 */
export async function inspectProjectConfig(
  cwd: string,
  options: { fix?: boolean; env?: Record<string, string | undefined> } = {},
): Promise<{
  configFile: string | null;
  fixesApplied: string[];
  issues: ConfigIssue[];
}> {
  const env = options.env ?? process.env;
  let result = await runConfigCheck(cwd, env);

  const fixesApplied: string[] = [];
  if (options.fix && result.configFile && Object.keys(result.config).length > 0) {
    const { config: fixed, fixes } = applyConfigFixes(result.config, cwd);
    if (fixes.length > 0) {
      await saveConfig(path.join(cwd, result.configFile), fixed);
      fixesApplied.push(...fixes);
      result = await runConfigCheck(cwd, env);
    }

    const zhinDiagnosis = diagnoseZhinStackDependencies(cwd, result.config);
    const zhinFixPackages = packagesNeedingZhinStackFix(zhinDiagnosis);
    if (zhinFixPackages.length > 0) {
      const changed = await mergeDependenciesIntoPackageJson(cwd, zhinDiagnosis.required);
      if (changed) {
        fixesApplied.push(`updated Zhin stack: ${zhinFixPackages.join(', ')}`);
        result = await runConfigCheck(cwd, env);
      }
    }

    const aiDiagnosis = diagnoseAIDependencies(cwd, result.config);
    const aiFixPackages = aiDiagnosis ? packagesNeedingAiStackFix(aiDiagnosis) : [];
    if (aiDiagnosis && aiFixPackages.length > 0) {
      const changed = await mergeDependenciesIntoPackageJson(cwd, aiDiagnosis.required);
      if (changed) {
        fixesApplied.push(`updated AI stack: ${aiFixPackages.join(', ')}`);
        result = await runConfigCheck(cwd, env);
      }
    }
  }

  return {
    configFile: result.configFile,
    fixesApplied,
    issues: result.issues,
  };
}
