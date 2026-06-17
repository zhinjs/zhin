import fs from 'fs-extra';
import path from 'path';
import { isValidLogLevelInput, toLogLevelName, type LogLevelInput } from '@zhin.js/logger';
import {
  diagnoseAIDependencies,
  formatAIDependencyFixCommand,
  isAiEnabledInConfig,
  mergeDependenciesIntoPackageJson,
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

const HOST_PLUGINS = ['@zhin.js/host-router', '@zhin.js/host-api'] as const;

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
  plugins: string[],
  issues: ConfigIssue[],
): void {
  const endpoints = config.endpoints;
  if (!endpoints) return;
  if (!Array.isArray(endpoints)) {
    pushIssue(issues, {
      severity: 'error',
      code: 'endpoints.invalid',
      path: 'endpoints',
      message: 'endpoints 必须是数组',
    });
    return;
  }
  if (endpoints.length === 0) {
    pushIssue(issues, {
      severity: 'warn',
      code: 'endpoints.empty',
      path: 'endpoints',
      message: '未配置任何 Endpoint 实例',
      fixHint: 'zhin setup --adapters',
    });
  }

  const pluginSet = new Set(plugins);
  endpoints.forEach((entry, index) => {
    const base = `endpoints[${index}]`;
    if (!entry || typeof entry !== 'object') {
      pushIssue(issues, {
        severity: 'error',
        code: 'endpoint.invalid',
        path: base,
        message: 'Endpoint 配置必须是对象',
      });
      return;
    }
    const row = entry as Record<string, unknown>;
    const context = typeof row.context === 'string' ? row.context : '';
    const name = typeof row.name === 'string' ? row.name : '';
    if (!context) {
      pushIssue(issues, {
        severity: 'error',
        code: 'endpoint.context_missing',
        path: `${base}.context`,
        message: 'Endpoint 缺少 context',
      });
    }
    if (!name) {
      pushIssue(issues, {
        severity: 'error',
        code: 'endpoint.name_missing',
        path: `${base}.name`,
        message: 'Endpoint 缺少 name',
      });
    }
    if (context === 'icqq' && (row.password != null || row.platform != null)) {
      pushIssue(issues, {
        severity: 'warn',
        code: 'icqq.legacy_login_fields',
        path: base,
        message: 'ICQQ 登录凭据应通过 icqq login 管理，不应写在 zhin.config 中',
        fixable: true,
        fixHint: 'zhin config check --fix 将移除 password/platform 字段',
      });
    }
    if (context) {
      const expected = adapterPluginForContext(context);
      if (!pluginSet.has(expected)) {
        pushIssue(issues, {
          severity: 'error',
          code: 'endpoint.adapter_plugin_missing',
          path: 'plugins',
          message: `endpoints[].context=${context} 需要插件 ${expected}`,
          fixable: true,
          fixHint: `zhin config check --fix 将把 ${expected} 加入 plugins`,
        });
      }
    }
  });
}

function checkPlugins(config: Record<string, unknown>, issues: ConfigIssue[]): string[] {
  const plugins = Array.isArray(config.plugins)
    ? config.plugins.map((p) => String(p))
    : [];

  for (const plugin of plugins) {
    if (RENAMED_PLUGINS[plugin]) {
      pushIssue(issues, {
        severity: 'error',
        code: 'plugins.renamed',
        path: 'plugins',
        message: `插件 ${plugin} 已重命名为 ${RENAMED_PLUGINS[plugin]}`,
        fixable: true,
        fixHint: 'zhin config check --fix',
      });
    }
  }

  const endpoints = Array.isArray(config.endpoints) ? config.endpoints : [];
  const needsHttp = endpoints.some((entry) => {
    const context = entry && typeof entry === 'object' ? String((entry as Record<string, unknown>).context ?? '') : '';
    return context === 'sandbox' || context === 'wechat-mp';
  }) || config.http != null || config.hostApi != null;

  if (needsHttp) {
    for (const hostPlugin of HOST_PLUGINS) {
      if (!plugins.includes(hostPlugin)) {
        pushIssue(issues, {
          severity: 'warn',
          code: 'plugins.host_missing',
          path: 'plugins',
          message: `建议启用 ${hostPlugin} 以使用控制台 / HTTP 能力`,
          fixable: true,
          fixHint: 'zhin config check --fix',
        });
      }
    }
  }

  return plugins;
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

function checkAiDependencies(
  cwd: string,
  config: Record<string, unknown>,
  issues: ConfigIssue[],
): void {
  const diagnosis = diagnoseAIDependencies(cwd, config);
  if (!diagnosis) return;

  if (diagnosis.missingFromPackageJson.length > 0) {
    pushIssue(issues, {
      severity: 'error',
      code: 'ai.deps_missing',
      path: 'package.json',
      message: `AI 已启用但 package.json 缺少依赖: ${diagnosis.missingFromPackageJson.join(', ')}`,
      fixable: true,
      fixHint: formatAIDependencyFixCommand(diagnosis.missingFromPackageJson, diagnosis.required),
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
      if (prov && typeof prov === 'object' && 'driver' in (prov as object)) {
        pushIssue(issues, {
          severity: 'warn',
          code: 'ai.provider_driver_deprecated',
          path: `ai.providers.${alias}.driver`,
          message: `ai.providers.${alias}.driver 应迁移为 api`,
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
        fixHint: 'zhin setup --ai 或 pnpm add @zhin.js/agent zod ai',
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

  const normalized = aiUtils.normalizeAiRoutingConfig(legacy);
  for (const err of aiUtils.validateAiRoutingConfig(normalized)) {
    pushIssue(issues, {
      severity: 'error',
      code: 'ai.routing_invalid',
      path: 'ai',
      message: err,
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

  const plugins = checkPlugins(config, issues);
  checkLogLevel(config, issues);
  checkDatabase(config, issues);
  checkEndpoints(config, plugins, issues);
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
    const endpoints = Array.isArray(next.endpoints) ? next.endpoints : [];
    const needsHttp = endpoints.some((entry) => {
      const context = entry && typeof entry === 'object' ? String((entry as Record<string, unknown>).context ?? '') : '';
      return context === 'sandbox' || context === 'wechat-mp';
    }) || next.http != null || next.hostApi != null;
    if (needsHttp) {
      for (const hostPlugin of HOST_PLUGINS) {
        if (!plugins.includes(hostPlugin)) {
          plugins.push(hostPlugin);
          fixes.push(`added ${hostPlugin} to plugins`);
          changed = true;
        }
      }
    }
    for (const entry of endpoints) {
      if (!entry || typeof entry !== 'object') continue;
      const context = String((entry as Record<string, unknown>).context ?? '');
      if (!context) continue;
      const expected = adapterPluginForContext(context);
      if (!plugins.includes(expected)) {
        plugins.push(expected);
        fixes.push(`added ${expected} for endpoints[].context=${context}`);
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

  if (Array.isArray(next.endpoints)) {
    next.endpoints = next.endpoints.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const row = { ...(entry as Record<string, unknown>) };
      if (row.context === 'icqq') {
        let changed = false;
        if ('password' in row) {
          delete row.password;
          changed = true;
        }
        if ('platform' in row) {
          delete row.platform;
          changed = true;
        }
        if (changed) fixes.push('removed legacy icqq password/platform fields from endpoints[]');
      }
      return row;
    });
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

    const aiDiagnosis = diagnoseAIDependencies(cwd, result.config);
    if (aiDiagnosis && aiDiagnosis.missingFromPackageJson.length > 0) {
      const changed = await mergeDependenciesIntoPackageJson(cwd, aiDiagnosis.required);
      if (changed) {
        fixesApplied.push(`added AI deps: ${aiDiagnosis.missingFromPackageJson.join(', ')}`);
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
