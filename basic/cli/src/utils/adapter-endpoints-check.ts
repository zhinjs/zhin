import fs from 'fs-extra';
import path from 'path';

export interface AdapterEndpointIssue {
  /** endpoint 名（缺 name 时为 #序号） */
  endpoint: string;
  /** 缺少的必填字段 */
  missing: string[];
}

/**
 * 从插件 instanceKey 推导 npm 包名并读取其 schema.json。
 * 适配器约定为 @zhin.js/adapter-<key>，功能插件为 @zhin.js/plugin-<key>；
 * key 本身含 scope（如 '@scope/pkg'）时直接按包名处理。
 * 直接走 node_modules 路径（pnpm 下为 symlink，existsSync 可穿透），
 * 不依赖包 exports 解析（多数插件包未导出 schema.json 子路径）。
 */
export function loadPluginSchemaJson(cwd: string, instanceKey: string): Record<string, unknown> | null {
  const candidates = instanceKey.includes('/')
    ? [instanceKey]
    : [`@zhin.js/adapter-${instanceKey}`, `@zhin.js/plugin-${instanceKey}`];
  for (const pkg of candidates) {
    const schemaPath = path.join(cwd, 'node_modules', pkg, 'schema.json');
    if (!fs.existsSync(schemaPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(schemaPath, 'utf-8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 对照适配器 schema.json 的 endpoints.items.required 检查配置缺字段。
 * endpoint 各项与插件顶层字段同构（顶层值被 endpoints[i] 继承/覆盖），
 * 因此合并顶层与 endpoint 后再判定必填项。
 */
export function findMissingEndpointFields(
  schema: Record<string, unknown> | null,
  pluginConf: Record<string, unknown>,
): AdapterEndpointIssue[] {
  const required = (
    (schema?.properties as Record<string, unknown> | undefined)
      ?.endpoints as { items?: { required?: unknown } } | undefined
  )?.items?.required;
  if (!Array.isArray(required) || required.length === 0) return [];

  const endpoints = pluginConf.endpoints;
  if (!Array.isArray(endpoints)) return [];

  const issues: AdapterEndpointIssue[] = [];
  endpoints.forEach((ep, i) => {
    if (!ep || typeof ep !== 'object' || Array.isArray(ep)) return;
    const merged: Record<string, unknown> = { ...pluginConf, ...(ep as Record<string, unknown>) };
    const missing = required
      .filter((f): f is string => typeof f === 'string')
      .filter((f) => merged[f] === undefined || merged[f] === '');
    if (missing.length > 0) {
      const name = (ep as Record<string, unknown>).name;
      issues.push({ endpoint: typeof name === 'string' && name ? name : `#${i}`, missing });
    }
  });
  return issues;
}
