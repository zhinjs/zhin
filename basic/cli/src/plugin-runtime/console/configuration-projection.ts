import { readPluginConfigurationMap, type ConfigPatch, type RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import { HOST_CONFIG_KEYS, readApplicationPluginDeclaration } from '@zhin.js/runtime';
const HOST_KEYS = new Set<string>([...HOST_CONFIG_KEYS, 'plugin']);
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** The Console presents business sections, never the package-name declaration map. */
export function flattenConfigDocument(document: RuntimeConfigDocument): Record<string, unknown> {
  readApplicationPluginDeclaration(document);
  const flat: Record<string, unknown> = {};
  for (const key of HOST_KEYS) if (Object.hasOwn(document, key)) Object.defineProperty(flat, key, {value: document[key], enumerable: true, configurable: true, writable: true});
  for (const [key, value] of Object.entries(readPluginConfigurationMap(document))) Object.defineProperty(flat, key, {value, enumerable: true, configurable: true, writable: true});
  return flat;
}

export function assertUnambiguousConfigKey(document: RuntimeConfigDocument, key: string): void {
  const declaration = readApplicationPluginDeclaration(document);
  if (FORBIDDEN.has(key) || !HOST_KEYS.has(key) && !declaration.instances.some(item => item.instanceKey === key)) throw new Error(`Unknown configuration key: ${key}; edit the configuration source to change declarations`);
}
export function configKeyPatch(document: RuntimeConfigDocument, key: string, data: unknown): ConfigPatch {
  assertUnambiguousConfigKey(document, key);
  return Object.freeze({op: 'set', path: Object.freeze([key]), value: data});
}
export function configKeyRemovePatch(document: RuntimeConfigDocument, key: string): ConfigPatch {
  assertUnambiguousConfigKey(document, key);
  return Object.freeze({op: 'remove', path: Object.freeze([key])});
}
