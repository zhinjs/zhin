import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getLogger } from '@zhin.js/logger';
import { readPluginConfigurationMap } from '@zhin.js/plugin-runtime';
import { HOST_CONFIG_KEYS, type RuntimeConfigDocument } from '@zhin.js/runtime';
import { readPluginPackageMap } from './plugin-schema.js';

export async function readProjectConfigYaml(projectRoot: string): Promise<string> {
  const file = await findConfigFile(projectRoot);
  if (!file) return '';
  return readFile(file, 'utf8');
}

export async function readProjectConfigDocument(projectRoot: string): Promise<Record<string, unknown>> {
  const file = await findConfigFile(projectRoot);
  if (!file) return {};
  const text = await readFile(file, 'utf8');
  if (file.endsWith('.json')) {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
  const value = parseYaml(text) as unknown;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Host 级配置键（与 ConfigComposer 对齐）。
 * 这些键在文档顶层；插件配置在 `plugins.<instanceKey>`。
 */
const HOST_CONFIG_KEY_SET = new Set<string>(HOST_CONFIG_KEYS);

const consoleApiLogger = getLogger('ConsoleApi');

/**
 * 禁止作为配置键的名称：写入 `__proto__`/`constructor`/`prototype`
 * 会污染对象原型，且 `__proto__` 经 YAML/JSON 序列化后丢失。
 */
const FORBIDDEN_CONFIG_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isForbiddenConfigKey(key: string): boolean {
  return FORBIDDEN_CONFIG_KEYS.has(key);
}

/** 安全写 own property（`__proto__` 等键走 defineProperty，避免触发原型 setter）。 */
function setOwnKey(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Console 视角的扁平配置：
 * - 顶层 host 键（http / database / …）原样
 * - `plugins.<key>` 展开为顶层 `key`（与 legacy `config:get(pluginName)` 契约一致）
 */
export async function readConsoleConfigDocument(
  projectRoot: string,
): Promise<Record<string, unknown>> {
  return flattenConfigDocument(await readProjectConfigDocument(projectRoot));
}

export function flattenConfigDocument(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (key === 'plugins' || isForbiddenConfigKey(key)) continue;
    setOwnKey(flat, key, value);
  }
  for (const [key, value] of Object.entries(readPluginConfigurationMap(document))) {
    if (isForbiddenConfigKey(key)) continue;
    // Host 键优先：plugins.<key> 与顶层键同名（如 instanceKey 叫 ai/http）时跳过，
    // 否则读写路径互相覆写（读 flat 拿到插件值、写 writeConfigKey 落到顶层 host 键）。
    if (Object.prototype.hasOwnProperty.call(flat, key)) {
      consoleApiLogger.warn(
        `plugins.${key} 与顶层 host 配置键同名，Console 扁平视图以 host 键为准，plugins.${key} 被跳过`,
      );
      continue;
    }
    setOwnKey(flat, key, value);
  }
  return flat;
}

/** 配置 Tab 列表：host 键（有值）+ plugins 键 + package.json zhin.plugins。 */
export async function listConsoleConfigKeys(
  projectRoot: string,
  primaryConfigDocument?: RuntimeConfigDocument,
): Promise<string[]> {
  const document = primaryConfigDocument ?? await readProjectConfigDocument(projectRoot);
  const keys = new Set<string>();
  for (const key of HOST_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(document, key)) keys.add(key);
  }
  for (const key of Object.keys(readPluginConfigurationMap(document))) keys.add(key);
  for (const key of (await readPluginPackageMap(projectRoot)).keys()) keys.add(key);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

async function findConfigFile(projectRoot: string): Promise<string | undefined> {
  for (const candidate of [
    'config.yml', 'config.yaml', 'config.json', 'zhin.config.yml', 'zhin.config.yaml',
  ]) {
    const file = join(projectRoot, candidate);
    try {
      await access(file);
      return file;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

async function ensureConfigFile(projectRoot: string): Promise<string> {
  const existing = await findConfigFile(projectRoot);
  if (existing) return existing;
  return join(projectRoot, 'zhin.config.yml');
}

export async function writeProjectConfigYaml(projectRoot: string, yaml: string): Promise<void> {
  // 写入前试解析：损坏的 YAML 一旦落盘，下次启动 runtime 将无法加载配置。
  // 解析失败抛错，RPC 层（/console/request）映射为 HTTP 400。
  try {
    parseYaml(yaml);
  } catch (error) {
    throw new Error(
      `Invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const file = await ensureConfigFile(projectRoot);
  await writeFile(file, yaml, 'utf8');
}

export async function writeProjectConfigKey(
  projectRoot: string,
  pluginName: string,
  data: unknown,
): Promise<{ restartRequired: boolean }> {
  const file = await ensureConfigFile(projectRoot);
  const document = await readProjectConfigDocument(projectRoot);
  writeConfigKey(document, pluginName, data);
  if (file.endsWith('.json')) {
    await writeFile(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  } else {
    await writeFile(file, stringifyYaml(document), 'utf8');
  }
  return { restartRequired: true };
}

export function writeConfigKey(
  document: Record<string, unknown>,
  key: string,
  data: unknown,
): void {
  // `__proto__` 等键：`key in document` 恒为 true 会写原型，且序列化后丢失，直接拒绝。
  if (isForbiddenConfigKey(key)) {
    throw new Error(`Invalid config key: ${key}`);
  }
  const plugins = readPluginConfigurationMap(document);
  const inPlugins = Object.prototype.hasOwnProperty.call(plugins, key);

  // Host 键或非 plugins 命名空间的顶层键写顶层；其余写 plugins.<key>
  if (HOST_CONFIG_KEY_SET.has(key)
    || (Object.prototype.hasOwnProperty.call(document, key) && key !== 'plugins' && !inPlugins)) {
    setOwnKey(document, key, data);
    return;
  }
  const bucket = document.plugins === undefined
    ? {}
    : plugins as Record<string, unknown>;
  setOwnKey(bucket, key, data);
  document.plugins = bucket;
}
