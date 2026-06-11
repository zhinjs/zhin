import fs from 'fs-extra';
import path from 'path';
import type { AdapterSetupResult, AISetupConfig, DatabaseConfig, InitOptions } from './types.js';
import { generateAdapterEnvVars, getAdapterDependencies } from './adapter.js';
import { generateAIEnvVars } from './ai.js';
import { ensureDatabaseForAdapters, ensureDatabaseForAI, getAIDependencies } from './project-deps.js';

/** Host 插件（Webhook / Console 必需） */
export const CONSOLE_HOST_PLUGINS = [
  '@zhin.js/host-router',
  '@zhin.js/host-api',
] as const;

export function applyDatabaseToConfig(config: Record<string, unknown>, database: DatabaseConfig): void {
  config.database = database;
  if (database.dialect === 'sqlite') {
    config.inbox = { enabled: true };
  }
}

export function applyAdaptersToConfig(config: Record<string, unknown>, result: AdapterSetupResult): void {
  const plugins = Array.isArray(config.plugins) ? [...config.plugins as string[]] : [];
  for (const plugin of result.plugins) {
    if (!plugins.includes(plugin)) plugins.push(plugin);
  }
  if (result.plugins.some((p: string) => p !== '@zhin.js/adapter-sandbox')) {
    for (const hostPlugin of CONSOLE_HOST_PLUGINS) {
      if (!plugins.includes(hostPlugin)) plugins.push(hostPlugin);
    }
  }
  config.plugins = plugins;

  const endpoints = Array.isArray(config.endpoints) ? [...config.endpoints as Record<string, unknown>[]] : [];
  endpoints.push(...result.endpoints);
  config.endpoints = endpoints;
}

export function applyAIToConfig(config: Record<string, unknown>, ai: AISetupConfig): void {
  config.ai = ai;
}

export async function appendWizardEnvVars(
  projectDir: string,
  adapters?: AdapterSetupResult,
  ai?: AISetupConfig,
): Promise<void> {
  const extra =
    (adapters ? generateAdapterEnvVars(adapters) : '') +
    (ai ? generateAIEnvVars(ai) : '');
  if (!extra) return;

  const envPath = path.join(projectDir, '.env');
  const existing = (await fs.pathExists(envPath)) ? await fs.readFile(envPath, 'utf-8') : '';
  await fs.writeFile(envPath, existing.replace(/\s*$/, '') + extra + '\n');
}

export function collectWizardDependencies(
  options: Pick<InitOptions, 'adapters' | 'ai'>,
): Record<string, string> {
  return {
    ...(options.adapters ? getAdapterDependencies(options.adapters) : {}),
    ...getAIDependencies(options.ai),
  };
}

export async function mergeDependenciesIntoPackageJson(
  projectDir: string,
  deps: Record<string, string>,
): Promise<boolean> {
  if (Object.keys(deps).length === 0) return false;
  const pkgPath = path.join(projectDir, 'package.json');
  if (!(await fs.pathExists(pkgPath))) return false;

  const pkg = await fs.readJson(pkgPath);
  pkg.dependencies = pkg.dependencies ?? {};
  let changed = false;
  for (const [name, version] of Object.entries(deps)) {
    if (pkg.dependencies[name] === version) continue;
    pkg.dependencies[name] = version;
    changed = true;
  }
  if (changed) {
    await fs.writeJson(pkgPath, pkg, { spaces: 2 });
  }
  return changed;
}

/** 交互向导结果写入 InitOptions 并补全 database 等前置条件 */
export function finalizeWizardOptions(options: InitOptions): void {
  ensureDatabaseForAI(options);
  ensureDatabaseForAdapters(options);
}

/** 将 InitOptions 中的 wizard 结果合并进已有 zhin 配置对象 */
export function applyWizardOptionsToConfig(config: Record<string, unknown>, options: InitOptions): void {
  if (options.database) applyDatabaseToConfig(config, options.database);
  if (options.adapters) applyAdaptersToConfig(config, options.adapters);
  if (options.ai) applyAIToConfig(config, options.ai);
}
