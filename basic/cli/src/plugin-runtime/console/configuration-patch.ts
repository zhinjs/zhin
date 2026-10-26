import { CONFIG_PATCH_LIMITS, HOST_CONFIG_PATCH_PATHS, type ConsoleConfigPatchOperation } from '@zhin.js/console-protocol';
import type { ConfigPatch, RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import { HOST_CONFIG_KEYS } from '@zhin.js/runtime';
import { assertUnambiguousConfigKey } from './configuration-projection.js';

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
/** Host keys a plugin may never claim: declarations, the root plugin section and transport. */
const UNCLAIMABLE_HOST_KEYS = new Set(['plugin', 'http']);
const HOST_KEY_SET = new Set<string>(HOST_CONFIG_KEYS);
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/u;

/** Raised for a malformed request or a path outside the caller's declared scope; nothing is written. */
export class ConfigPatchScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigPatchScopeError';
  }
}

/** Structural request checks shared by the RPC boundary and the store. */
export function normalizeConfigPatchOperations(value: unknown): readonly ConfigPatch[] {
  if (!Array.isArray(value) || value.length === 0) throw new ConfigPatchScopeError('patches 必须是非空数组');
  if (value.length > CONFIG_PATCH_LIMITS.maxOperations) {
    throw new ConfigPatchScopeError(`一次最多 ${CONFIG_PATCH_LIMITS.maxOperations} 个 patch`);
  }
  return Object.freeze(value.map((item, index): ConfigPatch => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ConfigPatchScopeError(`patches[${index}] 必须是对象`);
    const operation = item as Partial<ConsoleConfigPatchOperation> & Record<string, unknown>;
    const path = normalizePath(operation.path, `patches[${index}].path`);
    if (operation.op === 'set') {
      if (!Object.hasOwn(operation, 'value') || operation.value === undefined) {
        throw new ConfigPatchScopeError(`patches[${index}] 的 set 需要 value；删除请用 op: "remove"`);
      }
      return Object.freeze({ op: 'set', path, value: structuredClone(operation.value) });
    }
    if (operation.op === 'remove') return Object.freeze({ op: 'remove', path });
    throw new ConfigPatchScopeError(`patches[${index}].op 只能是 set 或 remove`);
  }));
}

function normalizePath(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > CONFIG_PATCH_LIMITS.maxPathDepth) {
    throw new ConfigPatchScopeError(`${label} 必须是 1–${CONFIG_PATCH_LIMITS.maxPathDepth} 段的字符串数组`);
  }
  for (const segment of value) {
    if (typeof segment !== 'string' || !segment || segment.length > CONFIG_PATCH_LIMITS.maxSegmentLength
      || FORBIDDEN_SEGMENTS.has(segment)) {
      throw new ConfigPatchScopeError(`${label} 含有无效路径段`);
    }
  }
  return Object.freeze([...value] as string[]);
}

/**
 * Reads `x-zhin-config.patchPaths` from a plugin's own JSON Schema root: dotted Host sub-paths
 * (at least two segments, e.g. `ai.decisions`) the plugin owns besides its instance block.
 */
export function readDeclaredPatchPaths(schema: Readonly<Record<string, unknown>> | null, instanceKey: string): readonly (readonly string[])[] {
  const metadata = schema?.['x-zhin-config'];
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const declared = (metadata as Record<string, unknown>).patchPaths;
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) throw new ConfigPatchScopeError(`${instanceKey} 的 x-zhin-config.patchPaths 必须是字符串数组`);
  return Object.freeze(declared.map((entry) => {
    const path = typeof entry === 'string' ? entry.split('.') : [];
    if (path.length < 2 || path.some(segment => !SEGMENT.test(segment) || FORBIDDEN_SEGMENTS.has(segment))
      || !HOST_KEY_SET.has(path[0]!) || UNCLAIMABLE_HOST_KEYS.has(path[0]!)) {
      throw new ConfigPatchScopeError(`${instanceKey} 的 x-zhin-config.patchPaths 项 ${String(entry)} 无效：只能声明 Host 配置下至少两级的路径（如 ai.decisions）`);
    }
    return Object.freeze(path);
  }));
}

/** Resolves the allowlist for one caller scope. Plugin scopes always include their own block. */
export function resolvePatchScope(
  document: RuntimeConfigDocument,
  instanceKey: string | undefined,
  declared: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  if (instanceKey === undefined) return HOST_CONFIG_PATCH_PATHS;
  if (HOST_KEY_SET.has(instanceKey)) {
    throw new ConfigPatchScopeError(`${instanceKey} 是 Host 配置键，不是插件实例；请省略 instanceKey 使用 Host 白名单`);
  }
  try {
    assertUnambiguousConfigKey(document, instanceKey);
  } catch {
    throw new ConfigPatchScopeError(`未声明的插件实例：${instanceKey}`);
  }
  return Object.freeze([Object.freeze([instanceKey]), ...declared]);
}

export function assertPatchesInScope(patches: readonly ConfigPatch[], allowed: readonly (readonly string[])[], scopeLabel: string): void {
  for (const patch of patches) {
    const inside = allowed.some(prefix => prefix.length <= patch.path.length
      && prefix.every((segment, index) => patch.path[index] === segment));
    if (!inside) {
      throw new ConfigPatchScopeError(`路径 ${patch.path.join('.')} 不在 ${scopeLabel} 可写范围内（允许：${allowed.map(path => path.join('.')).join('、') || '无'}）`);
    }
  }
}

export function readPath(document: RuntimeConfigDocument, path: readonly string[]): unknown {
  let value: unknown = document;
  for (const segment of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return structuredClone(value);
}
