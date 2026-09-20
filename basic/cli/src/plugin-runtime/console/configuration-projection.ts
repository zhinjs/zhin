import { getLogger } from '@zhin.js/logger';
import {
  readPluginConfigurationMap,
  type ConfigPatch,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import { HOST_CONFIG_KEYS } from '@zhin.js/runtime';

const HOST_CONFIG_KEY_SET = new Set<string>(HOST_CONFIG_KEYS);
const FORBIDDEN_CONFIG_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const consoleApiLogger = getLogger('ConsoleApi');

/** Projects the canonical nested Root document into the Console's key-oriented view. */
export function flattenConfigDocument(
  document: RuntimeConfigDocument,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (key === 'plugins' || isForbiddenConfigKey(key)) continue;
    setOwnKey(flat, key, value);
  }
  for (const [key, value] of Object.entries(readPluginConfigurationMap(document))) {
    if (isForbiddenConfigKey(key)) continue;
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

/** Builds the one canonical structural patch for a Console key update. */
export function configKeyPatch(
  document: RuntimeConfigDocument,
  key: string,
  data: unknown,
): ConfigPatch {
  if (isForbiddenConfigKey(key)) throw new Error(`Invalid config key: ${key}`);
  const plugins = readPluginConfigurationMap(document);
  const inPlugins = Object.prototype.hasOwnProperty.call(plugins, key);
  const topLevel = HOST_CONFIG_KEY_SET.has(key)
    || (Object.prototype.hasOwnProperty.call(document, key) && key !== 'plugins' && !inPlugins);
  return Object.freeze({
    op: 'set',
    path: Object.freeze(topLevel ? [key] : ['plugins', key]),
    value: data,
  });
}

function isForbiddenConfigKey(key: string): boolean {
  return FORBIDDEN_CONFIG_KEYS.has(key);
}

function setOwnKey(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
